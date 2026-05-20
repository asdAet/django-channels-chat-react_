"""Asynchronous delivery pipeline for chat websocket messages."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any

from channels.db import database_sync_to_async

from chat_app_django.media_utils import build_profile_url, serialize_avatar_crop
from chat_app_django.metrics import observe_ws_event
from chat_app_django.security.audit import audit_ws_event, wait_for_audit_event
from direct_inbox.state import (
    is_room_active,
    mark_read as mark_direct_read,
    mark_unread,
    user_group_name,
)
from roles.models import Membership
from rooms.models import Room
from users.identity import (
    user_display_name,
    user_profile_avatar_source,
    user_public_ref,
    user_public_username,
)

from .unread_push import build_room_unread_events_for_user_ids, get_room_unread_recipient_user_ids

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class ChatMessageDelivery:
    """Immutable snapshot needed after a message has already been saved."""

    scope: dict[str, Any]
    room_id: int
    room_kind: str
    room_group_name: str
    chat_event: dict[str, Any]
    message_id: int
    sender_id: int | None
    message: str
    created_at: str
    direct_inbox_unread_ttl: int


class ChatMessageDeliveryDispatcher:
    """Runs post-save delivery outside the inbound websocket receive path."""

    def __init__(self, *, channel_layer, logger: logging.Logger | None = None):
        self._channel_layer = channel_layer
        self._logger = logger or logging.getLogger(__name__)
        self._publish_queue: asyncio.Queue[ChatMessageDelivery] = asyncio.Queue()
        self._side_effect_queue: asyncio.Queue[ChatMessageDelivery] = asyncio.Queue()
        self._publish_task: asyncio.Task | None = None
        self._side_effect_task: asyncio.Task | None = None

    def enqueue(self, delivery: ChatMessageDelivery) -> None:
        self._publish_queue.put_nowait(delivery)
        self._ensure_publish_worker()

    def _ensure_publish_worker(self) -> None:
        if self._publish_task is not None and not self._publish_task.done():
            return
        self._publish_task = asyncio.create_task(self._run_publish_worker())

    def _ensure_side_effect_worker(self) -> None:
        if self._side_effect_task is not None and not self._side_effect_task.done():
            return
        self._side_effect_task = asyncio.create_task(self._run_side_effect_worker())

    async def flush(self) -> None:
        """Wait until all queued publish and side-effect work has settled."""

        while True:
            publish_task = self._publish_task
            side_effect_task = self._side_effect_task
            pending_tasks = [
                task
                for task in (publish_task, side_effect_task)
                if task is not None and not task.done()
            ]
            if (
                not pending_tasks
                and self._publish_queue.empty()
                and self._side_effect_queue.empty()
            ):
                return

            if pending_tasks:
                await asyncio.gather(*pending_tasks, return_exceptions=False)
                continue
            if not self._publish_queue.empty():
                self._ensure_publish_worker()
                await self._publish_queue.join()
            if not self._side_effect_queue.empty():
                self._ensure_side_effect_worker()
                await self._side_effect_queue.join()

    async def _run_publish_worker(self) -> None:
        try:
            while not self._publish_queue.empty():
                delivery = await self._publish_queue.get()
                try:
                    await publish_chat_message(delivery, self._channel_layer)
                    self._side_effect_queue.put_nowait(delivery)
                    self._ensure_side_effect_worker()
                except asyncio.CancelledError:
                    raise
                except Exception:
                    self._logger.exception(
                        "Chat message publish failed",
                        extra={"room_id": delivery.room_id},
                    )
                finally:
                    self._publish_queue.task_done()
        finally:
            self._publish_task = None
            if not self._publish_queue.empty():
                self._ensure_publish_worker()

    async def _run_side_effect_worker(self) -> None:
        try:
            while not self._side_effect_queue.empty():
                delivery = await self._side_effect_queue.get()
                try:
                    await run_chat_message_side_effects(delivery, self._channel_layer)
                except asyncio.CancelledError:
                    raise
                except Exception:
                    self._logger.exception(
                        "Chat message side effects failed",
                        extra={"room_id": delivery.room_id},
                    )
                finally:
                    self._side_effect_queue.task_done()
        finally:
            self._side_effect_task = None
            if not self._side_effect_queue.empty():
                self._ensure_side_effect_worker()


async def publish_chat_message(delivery: ChatMessageDelivery, channel_layer) -> None:
    """Fan out the room message without waiting for slower side effects."""

    await channel_layer.group_send(delivery.room_group_name, dict(delivery.chat_event))


async def run_chat_message_side_effects(delivery: ChatMessageDelivery, channel_layer) -> None:
    """Update inbox and unread state after the message is already published."""

    audit_task = audit_ws_event(
        "ws.message.sent",
        delivery.scope,
        endpoint="chat",
        room_id=delivery.room_id,
        message_length=len(delivery.message),
    )
    observe_ws_event("chat", event_type="message_send", result="accepted")

    if delivery.room_kind == Room.Kind.DIRECT and delivery.sender_id is not None:
        direct_events = await _build_direct_inbox_events(
            room_id=delivery.room_id,
            message_id=delivery.message_id,
            sender_id=int(delivery.sender_id),
            message=delivery.message,
            created_at=delivery.created_at,
            unread_ttl=delivery.direct_inbox_unread_ttl,
            scope=delivery.scope,
        )
        await _send_direct_inbox_events(channel_layer, direct_events)

    unread_events = await _build_room_unread_events(delivery.room_id)
    await _send_direct_inbox_events(channel_layer, unread_events)
    await wait_for_audit_event(audit_task)


async def _send_direct_inbox_events(channel_layer, events: list[dict[str, Any]]) -> None:
    if not events:
        return
    await asyncio.gather(
        *(
            channel_layer.group_send(
                event["group"],
                {
                    "type": "direct_inbox_event",
                    "payload": event["payload"],
                },
            )
            for event in events
        )
    )


def _build_room_unread_events_sync(room_id: int) -> list[dict[str, Any]]:
    room = Room.objects.filter(pk=room_id).first()
    if not room:
        return []
    return build_room_unread_events_for_user_ids(get_room_unread_recipient_user_ids(room))


_build_room_unread_events = database_sync_to_async(
    _build_room_unread_events_sync,
    thread_sensitive=True,
)


def _build_direct_inbox_events_sync(
    *,
    room_id: int,
    message_id: int,
    sender_id: int,
    message: str,
    created_at: str,
    unread_ttl: int,
    scope: dict[str, Any],
) -> list[dict[str, Any]]:
    room = Room.objects.filter(id=room_id, kind=Room.Kind.DIRECT).first()
    if not room:
        return []

    memberships = list(
        Membership.objects.filter(room=room, is_banned=False)
        .select_related("user", "user__profile")
        .order_by("id")
    )

    pair_user_ids: set[int] = set()
    if room.direct_pair_key and ":" in room.direct_pair_key:
        first, second = room.direct_pair_key.split(":", 1)
        try:
            pair_user_ids = {int(first), int(second)}
        except (TypeError, ValueError):
            pair_user_ids = set()
    if len(pair_user_ids) != 2:
        return []

    participants = []
    seen_user_ids: set[int] = set()
    for membership in memberships:
        user = membership.user
        if not user:
            continue
        if pair_user_ids and user.pk not in pair_user_ids:
            continue
        if user.pk in seen_user_ids:
            continue
        seen_user_ids.add(user.pk)
        participants.append(user)

    if pair_user_ids and seen_user_ids != pair_user_ids:
        return []

    if not participants:
        return []

    events: list[dict[str, Any]] = []
    for participant in participants:
        peer = next(
            (candidate for candidate in participants if candidate.pk != participant.pk),
            None,
        )
        peer_avatar_source = ""
        peer_avatar_crop = None
        if peer:
            peer_profile = getattr(peer, "profile", None)
            peer_avatar_source = user_profile_avatar_source(peer) or ""
            peer_avatar_crop = serialize_avatar_crop(peer_profile)

        if participant.pk == sender_id:
            unread_state = mark_direct_read(participant.pk, room.pk, unread_ttl)
        elif is_room_active(participant.pk, room.pk):
            from .services import mark_read as service_mark_read

            try:
                service_mark_read(participant, room, message_id)
            except Exception:
                logger.exception(
                    "Failed to mark active direct room as read",
                    extra={"room_id": room.pk, "user_id": participant.pk},
                )
            unread_state = mark_direct_read(participant.pk, room.pk, unread_ttl)
        else:
            unread_state = mark_unread(participant.pk, room.pk, unread_ttl)

        room_ids = unread_state.get("roomIds", [])
        raw_counts = unread_state.get("counts", {})
        counts = raw_counts if isinstance(raw_counts, dict) else {}
        unread_count = counts.get(str(room.pk), 0)
        payload = {
            "type": "direct_inbox_item",
            "item": {
                "roomId": room.pk,
                "peer": {
                    "publicRef": user_public_ref(peer) if peer else "",
                    "username": user_public_username(peer) if peer else "",
                    "displayName": user_display_name(peer) if peer else "",
                    "profileImage": (
                        build_profile_url(scope, peer_avatar_source)
                        if peer_avatar_source
                        else None
                    ),
                    "avatarCrop": peer_avatar_crop,
                },
                "lastMessage": message,
                "lastMessageAt": created_at,
            },
            "unread": {
                "roomId": room.pk,
                "isUnread": unread_count > 0,
                "dialogs": unread_state.get("dialogs", len(room_ids)),
                "roomIds": room_ids,
                "counts": counts,
            },
        }
        events.append({"group": user_group_name(participant.pk), "payload": payload})
    return events


_build_direct_inbox_events = database_sync_to_async(
    _build_direct_inbox_events_sync,
    thread_sensitive=True,
)
