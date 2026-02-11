import asyncio
import hashlib
import json
import re
import time
from asgiref.sync import sync_to_async
from django.core.exceptions import ObjectDoesNotExist
from django.utils.text import slugify
from django.conf import settings
from django.core.cache import cache
from chat_app_django.ip_utils import get_client_ip_from_scope

from channels.generic.websocket import AsyncWebsocketConsumer

from .constants import (
    CHAT_CLOSE_IDLE_CODE,
    PRESENCE_CACHE_KEY_AUTH,
    PRESENCE_CACHE_KEY_GUEST,
    PRESENCE_CACHE_TTL_SECONDS,
    PRESENCE_CLOSE_IDLE_CODE,
    PRESENCE_GROUP_AUTH,
    PRESENCE_GROUP_GUEST,
    PUBLIC_ROOM_SLUG,
)
from .models import Message
from .utils import build_profile_url


def _is_valid_room_slug(value: str) -> bool:
    pattern = getattr(settings, "CHAT_ROOM_SLUG_REGEX", r"^[A-Za-z0-9_-]{3,50}$")
    try:
        return bool(re.match(pattern, value or ""))
    except re.error:
        return False


class ChatConsumer(AsyncWebsocketConsumer):
    chat_idle_timeout = int(getattr(settings, "CHAT_WS_IDLE_TIMEOUT", 600))
    """
    A consumer does three things:
    1. Accepts connections.
    2. Receives messages from client.
    3. Disconnects when the job is done.
    """

    async def connect(self):
        """
        Connect to a room
        """
        user = self.scope['user']
        self.room_name = self.scope['url_route']['kwargs']['room_name']

        if self.room_name != PUBLIC_ROOM_SLUG and not _is_valid_room_slug(self.room_name):
            await self.close()
            return

        is_public = self.room_name == PUBLIC_ROOM_SLUG
        if not user.is_authenticated and not is_public:
            await self.send({"close": True})
            return

        normalized = slugify(self.room_name)
        if not normalized:
            normalized = hashlib.sha1(self.room_name.encode("utf-8")).hexdigest()
        normalized = normalized[:80]  # trim length to satisfy Channels validation
        self.room_group_name = f"chat_{normalized}"

        # Join room group
        await self.channel_layer.group_add(
            self.room_group_name,
            self.channel_name
        )
        await self.accept()

        self._last_activity = time.monotonic()
        self._idle_task = None
        if self.chat_idle_timeout > 0:
            self._idle_task = asyncio.create_task(self._idle_watchdog())

    async def disconnect(self, close_code):
        """
        Disconnect from channel

        :param close_code: optional
        """
        idle_task = getattr(self, "_idle_task", None)
        if idle_task:
            idle_task.cancel()
            try:
                await idle_task
            except asyncio.CancelledError:
                pass

        await self.channel_layer.group_discard(
            self.room_group_name,
            self.channel_name
        )

    async def receive(self, text_data):
        """
        Receive messages from WebSocket

        :param text_data: message
        """

        self._last_activity = time.monotonic()
        try:
            text_data_json = json.loads(text_data)
        except json.JSONDecodeError:
            return

        message = text_data_json.get("message", "")
        if not isinstance(message, str):
            return
        message = message.strip()
        if not message:
            return

        max_len = int(getattr(settings, "CHAT_MESSAGE_MAX_LENGTH", 1000))
        if len(message) > max_len:
            await self.send(text_data=json.dumps({"error": "message_too_long"}))
            return

        user = self.scope['user']
        if not user.is_authenticated:
            return

        if await self._rate_limited(user):
            await self.send(text_data=json.dumps({"error": "rate_limited"}))
            return

        username = user.username
        room = self.room_name

        profile_name = await self._get_profile_image_name(user)
        profile_url = build_profile_url(self.scope, profile_name)

        await self.save_message(message, user, username, profile_name, room)

        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'chat_message',
                'message': message,
                'username': username,
                'profile_pic': profile_url,
                'room': room,
            }
        )

    async def chat_message(self, event):
        """
        Receive messages from room group

        :param event: Events to pick up
        """
        self._last_activity = time.monotonic()
        message = event['message']
        username = event['username']
        profile_pic = event['profile_pic']
        room = event['room']

        await self.send(text_data=json.dumps({
            'message': message,
            'username': username,
            'profile_pic': profile_pic,
            'room': room,
        }))

    async def _idle_watchdog(self):
        interval = max(10, min(60, self.chat_idle_timeout))
        while True:
            await asyncio.sleep(interval)
            if (time.monotonic() - self._last_activity) <= self.chat_idle_timeout:
                continue
            await self.close(code=CHAT_CLOSE_IDLE_CODE)
            break

    @sync_to_async
    def save_message(self, message, user, username, profile_pic, room):
        Message.objects.create(
            message_content=message,
            username=username,
            user=user,
            profile_pic=profile_pic,
            room=room,
        )

    @sync_to_async
    def _get_profile_image_name(self, user) -> str:
        try:
            profile = user.profile
            name = getattr(profile.image, "name", "")
            return name or ""
        except (AttributeError, ObjectDoesNotExist):
            return ""

    @sync_to_async
    def _rate_limited(self, user) -> bool:
        limit = int(getattr(settings, "CHAT_MESSAGE_RATE_LIMIT", 20))
        window = int(getattr(settings, "CHAT_MESSAGE_RATE_WINDOW", 10))
        key = f"rl:chat:{user.id}"
        now = time.time()
        data = cache.get(key)
        if not data or data.get("reset", 0) <= now:
            cache.set(key, {"count": 1, "reset": now + window}, timeout=window)
            return False
        if data.get("count", 0) >= limit:
            return True
        data["count"] = data.get("count", 0) + 1
        cache.set(key, data, timeout=max(1, int(data["reset"] - now)))
        return False


class PresenceConsumer(AsyncWebsocketConsumer):
    group_name_auth = PRESENCE_GROUP_AUTH
    group_name_guest = PRESENCE_GROUP_GUEST
    cache_key = PRESENCE_CACHE_KEY_AUTH
    guest_cache_key = PRESENCE_CACHE_KEY_GUEST
    presence_ttl = int(getattr(settings, "PRESENCE_TTL", 90))
    presence_grace = int(getattr(settings, "PRESENCE_GRACE", 5))
    presence_heartbeat = int(getattr(settings, "PRESENCE_HEARTBEAT", 20))
    presence_idle_timeout = int(getattr(settings, "PRESENCE_IDLE_TIMEOUT", 90))
    cache_timeout_seconds = PRESENCE_CACHE_TTL_SECONDS
    presence_touch_interval = int(getattr(settings, "PRESENCE_TOUCH_INTERVAL", 30))

    async def connect(self):
        user = self.scope.get("user")
        self.is_guest = not user or not user.is_authenticated
        self.group_name = (
            self.group_name_guest if self.is_guest else self.group_name_auth
        )
        self.guest_ip = self._get_client_ip() if self.is_guest else None

        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

        self._last_client_activity = time.monotonic()
        self._next_presence_touch_at = 0.0
        self._heartbeat_task = asyncio.create_task(self._heartbeat())
        self._idle_task = None
        if self.presence_idle_timeout > 0:
            self._idle_task = asyncio.create_task(self._idle_watchdog())

        if self.is_guest:
            await self._add_guest(self.guest_ip)
        else:
            await self._add_user(user)
        await self._broadcast()

    async def disconnect(self, close_code):
        for task_name in ("_heartbeat_task", "_idle_task"):
            task = getattr(self, task_name, None)
            if not task:
                continue
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

        user = self.scope.get("user")
        graceful = close_code in (1000, 1001)
        if self.is_guest:
            await self._remove_guest(self.guest_ip, graceful=graceful)
        elif user and user.is_authenticated:
            await self._remove_user(user, graceful=graceful)

        await self._broadcast()
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive(self, text_data=None, bytes_data=None):
        if not text_data:
            return
        now = time.monotonic()
        self._last_client_activity = now
        try:
            payload = json.loads(text_data)
        except json.JSONDecodeError:
            return
        if payload.get("type") != "ping":
            return

        if now < self._next_presence_touch_at:
            return
        self._next_presence_touch_at = now + self.presence_touch_interval

        user = self.scope.get("user")
        if self.is_guest:
            await self._touch_guest(self.guest_ip)
        elif user and user.is_authenticated:
            await self._touch_user(user)

    async def _broadcast(self):
        online = await self._get_online()
        guests = await self._get_guest_count()
        await self.channel_layer.group_send(
            self.group_name_guest,
            {"type": "presence.update", "guests": guests},
        )
        await self.channel_layer.group_send(
            self.group_name_auth,
            {"type": "presence.update", "online": online, "guests": guests},
        )

    async def presence_update(self, event):
        payload = {}
        if "online" in event:
            payload["online"] = event["online"]
        if "guests" in event:
            payload["guests"] = event["guests"]
        if payload:
            await self.send(text_data=json.dumps(payload))

    async def _heartbeat(self):
        interval = max(5, self.presence_heartbeat)
        while True:
            await asyncio.sleep(interval)
            try:
                await self.send(text_data=json.dumps({"type": "ping"}))
            except Exception:
                break

    async def _idle_watchdog(self):
        interval = max(5, min(self.presence_heartbeat, self.presence_idle_timeout))
        while True:
            await asyncio.sleep(interval)
            if (time.monotonic() - self._last_client_activity) <= self.presence_idle_timeout:
                continue
            await self.close(code=PRESENCE_CLOSE_IDLE_CODE)
            break

    @sync_to_async
    def _add_user(self, user):
        data = cache.get(self.cache_key, {})
        current = data.get(user.username, {})
        count = current.get("count", 0) + 1
        image_name = getattr(getattr(user, "profile", None), "image", None)
        image_name = image_name.name if image_name else ""
        image_url = build_profile_url(self.scope, image_name) if image_name else None
        data[user.username] = {
            "count": count,
            "profileImage": image_url,
            "last_seen": time.time(),
            "grace_until": 0,
        }
        cache.set(self.cache_key, data, timeout=self.cache_timeout_seconds)

    @sync_to_async
    def _remove_user(self, user, graceful: bool = False):
        data = cache.get(self.cache_key, {})
        if user.username in data:
            entry = data[user.username]
            count = entry.get("count", 1) - 1
            now = time.time()
            if count <= 0:
                if graceful or self.presence_grace <= 0:
                    data.pop(user.username, None)
                else:
                    entry["count"] = 0
                    entry["last_seen"] = now
                    entry["grace_until"] = now + self.presence_grace
                    data[user.username] = entry
            else:
                entry["count"] = count
                entry["last_seen"] = now
                entry["grace_until"] = 0
                data[user.username] = entry
            cache.set(self.cache_key, data, timeout=self.cache_timeout_seconds)

    @sync_to_async
    def _get_online(self):
        data = cache.get(self.cache_key, {})
        now = time.time()
        cleaned = {}
        for username, info in data.items():
            try:
                count = int(info.get("count", 0))
            except (TypeError, ValueError):
                count = 0
            last_seen = info.get("last_seen", 0)
            grace_until = info.get("grace_until", 0)
            if count > 0 and (now - last_seen) <= self.presence_ttl:
                cleaned[username] = info
            elif (
                count <= 0
                and grace_until
                and grace_until > now
                and (now - last_seen) <= self.presence_ttl
            ):
                cleaned[username] = info
        if cleaned != data:
            cache.set(self.cache_key, cleaned, timeout=self.cache_timeout_seconds)
        return [
            {"username": username, "profileImage": info.get("profileImage")}
            for username, info in cleaned.items()
        ]

    @sync_to_async
    def _add_guest(self, ip: str | None):
        if not ip:
            return
        data = cache.get(self.guest_cache_key, {}) or {}
        current = data.get(ip, {})
        try:
            count = int(current.get("count", 0))
        except (TypeError, ValueError, AttributeError):
            count = 0
        data[ip] = {"count": count + 1, "last_seen": time.time(), "grace_until": 0}
        cache.set(self.guest_cache_key, data, timeout=self.cache_timeout_seconds)

    @sync_to_async
    def _remove_guest(self, ip: str | None, graceful: bool = False):
        if not ip:
            return
        data = cache.get(self.guest_cache_key, {}) or {}
        current = data.get(ip, {})
        try:
            count = int(current.get("count", 0))
        except (TypeError, ValueError, AttributeError):
            count = 0
        count -= 1
        now = time.time()
        if count <= 0:
            if graceful or self.presence_grace <= 0:
                data.pop(ip, None)
            else:
                data[ip] = {"count": 0, "last_seen": now, "grace_until": now + self.presence_grace}
        else:
            data[ip] = {"count": count, "last_seen": now, "grace_until": 0}
        if data:
            cache.set(self.guest_cache_key, data, timeout=self.cache_timeout_seconds)
        else:
            cache.delete(self.guest_cache_key)

    @sync_to_async
    def _get_guest_count(self) -> int:
        data = cache.get(self.guest_cache_key, {}) or {}
        now = time.time()
        cleaned = {}
        for ip, info in data.items():
            try:
                count = int(info.get("count", 0))
            except (TypeError, ValueError, AttributeError):
                count = 0
            last_seen = info.get("last_seen", 0)
            grace_until = info.get("grace_until", 0)
            if count > 0 and (now - last_seen) <= self.presence_ttl:
                cleaned[ip] = info
            elif (
                count <= 0
                and grace_until
                and grace_until > now
                and (now - last_seen) <= self.presence_ttl
            ):
                cleaned[ip] = info
        if cleaned != data:
            cache.set(self.guest_cache_key, cleaned, timeout=self.cache_timeout_seconds)
        return len(cleaned)

    @sync_to_async
    def _touch_user(self, user):
        data = cache.get(self.cache_key, {})
        current = data.get(user.username)
        image_name = getattr(getattr(user, "profile", None), "image", None)
        image_name = image_name.name if image_name else ""
        image_url = build_profile_url(self.scope, image_name) if image_name else None
        if not current:
            data[user.username] = {
                "count": 1,
                "profileImage": image_url,
                "last_seen": time.time(),
                "grace_until": 0,
            }
        else:
            current["last_seen"] = time.time()
            current["grace_until"] = 0
            if image_url:
                current["profileImage"] = image_url
            data[user.username] = current
        cache.set(self.cache_key, data, timeout=self.cache_timeout_seconds)

    @sync_to_async
    def _touch_guest(self, ip: str | None):
        if not ip:
            return
        data = cache.get(self.guest_cache_key, {}) or {}
        current = data.get(ip)
        if not current:
            data[ip] = {"count": 1, "last_seen": time.time(), "grace_until": 0}
        else:
            data[ip] = {
                "count": current.get("count", 1),
                "last_seen": time.time(),
                "grace_until": 0,
            }
        cache.set(self.guest_cache_key, data, timeout=self.cache_timeout_seconds)

    def _decode_header(self, value: bytes | None) -> str | None:
        if not value:
            return None
        try:
            return value.decode("utf-8")
        except UnicodeDecodeError:
            return value.decode("latin-1", errors="ignore")

    def _get_client_ip(self) -> str | None:
        return get_client_ip_from_scope(self.scope)



