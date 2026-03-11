"""Friend management use-cases."""

from __future__ import annotations

from django.db import models, transaction

from chat_app_django.security.audit import audit_security_event
from friends.application.errors import (
    FriendConflictError,
    FriendForbiddenError,
    FriendNotFoundError,
    FriendServiceError,
)
from friends.domain import rules
from friends.infrastructure import repositories
from friends.models import Friendship


def _ensure_authenticated(actor) -> None:
    if not actor or not getattr(actor, "is_authenticated", False):
        raise FriendForbiddenError("Требуется аутентификация")


def _normalize_username(raw: str) -> str:
    if not isinstance(raw, str):
        return ""
    return raw.strip().lstrip("@")


def _friend_from_user_id(friendship: Friendship) -> int:
    from_user_id = getattr(friendship, "from_user_id", None)
    if from_user_id is not None:
        return int(from_user_id)
    from_user = getattr(friendship, "from_user", None)
    from_user_pk = getattr(from_user, "pk", None)
    if from_user_pk is None:
        raise FriendServiceError("Не указан отправитель дружбы")
    return int(from_user_pk)


def _friend_to_user_id(friendship: Friendship) -> int:
    to_user_id = getattr(friendship, "to_user_id", None)
    if to_user_id is not None:
        return int(to_user_id)
    to_user = getattr(friendship, "to_user", None)
    to_user_pk = getattr(to_user, "pk", None)
    if to_user_pk is None:
        raise FriendServiceError("Не указан получатель дружбы")
    return int(to_user_pk)


# ── Queries ───────────────────────────────────────────────────────────

def list_friends(actor) -> list:
    _ensure_authenticated(actor)
    return list(repositories.list_friends_for_user(actor))


def list_incoming_requests(actor) -> list:
    _ensure_authenticated(actor)
    return list(repositories.list_pending_incoming(actor))


def list_outgoing_requests(actor) -> list:
    _ensure_authenticated(actor)
    return list(repositories.list_pending_outgoing(actor))


def list_blocked(actor) -> list:
    _ensure_authenticated(actor)
    return list(repositories.list_blocked_by_user(actor))


def is_blocked_between(user_a, user_b) -> bool:
    """Return True if either user has blocked the other."""
    return Friendship.objects.filter(
        status=Friendship.Status.BLOCKED,
    ).filter(
        models.Q(from_user=user_a, to_user=user_b)
        | models.Q(from_user=user_b, to_user=user_a)
    ).exists()


# ── Send request ──────────────────────────────────────────────────────

def send_request(actor, target_username: str) -> Friendship:
    _ensure_authenticated(actor)
    username = _normalize_username(target_username)
    if not username:
        raise FriendServiceError("Требуется имя пользователя")

    target = repositories.get_user_by_username(username)
    if not target:
        raise FriendNotFoundError("Пользователь не найден")

    if rules.is_self_request(actor.pk, target.pk):
        raise FriendServiceError("Нельзя отправить заявку в друзья самому себе")

    outgoing = repositories.get_friendship(actor, target)
    incoming = repositories.get_friendship(target, actor)

    allowed, reason = rules.can_send_request(
        existing_outgoing_status=outgoing.status if outgoing else None,
        existing_incoming_status=incoming.status if incoming else None,
    )
    if not allowed:
        raise FriendConflictError(reason)

    # Auto-accept if they already sent us a request
    if rules.should_auto_accept(incoming.status if incoming else None):
        if incoming is None:
            raise FriendConflictError("Входящая заявка не найдена")
        with transaction.atomic():
            incoming.status = Friendship.Status.ACCEPTED
            incoming.save(update_fields=["status", "updated_at"])
            friendship, _ = Friendship.objects.update_or_create(
                from_user=actor,
                to_user=target,
                defaults={"status": Friendship.Status.ACCEPTED},
            )
        audit_security_event(
            "friendship.auto_accepted",
            actor_user=actor,
            actor_user_id=actor.pk,
            actor_username=actor.username,
            is_authenticated=True,
            target_user_id=target.pk,
            target_username=target.username,
        )
        return friendship

    # Create or update to pending (handles re-request after decline)
    with transaction.atomic():
        friendship, _ = Friendship.objects.update_or_create(
            from_user=actor,
            to_user=target,
            defaults={"status": Friendship.Status.PENDING},
        )

    audit_security_event(
        "friendship.request_sent",
        actor_user=actor,
        actor_user_id=actor.pk,
        actor_username=actor.username,
        is_authenticated=True,
        target_user_id=target.pk,
        target_username=target.username,
    )
    return friendship


# ── Accept / Decline ──────────────────────────────────────────────────

def accept_request(actor, friendship_id: int) -> Friendship:
    _ensure_authenticated(actor)
    friendship = repositories.get_friendship_by_id(int(friendship_id))
    if not friendship or friendship.status != Friendship.Status.PENDING:
        raise FriendNotFoundError("Заявка в ожидании не найдена")

    if not rules.can_accept_request(
        request_to_user_id=_friend_to_user_id(friendship),
        actor_id=actor.pk,
    ):
        raise FriendForbiddenError("Только получатель может принять эту заявку")

    with transaction.atomic():
        friendship.status = Friendship.Status.ACCEPTED
        friendship.save(update_fields=["status", "updated_at"])
        # Create reverse friendship
        Friendship.objects.update_or_create(
            from_user=friendship.to_user,
            to_user=friendship.from_user,
            defaults={"status": Friendship.Status.ACCEPTED},
        )

    audit_security_event(
        "friendship.accepted",
        actor_user=actor,
        actor_user_id=actor.pk,
        actor_username=actor.username,
        is_authenticated=True,
        from_user_id=_friend_from_user_id(friendship),
    )
    return friendship


def decline_request(actor, friendship_id: int) -> Friendship:
    _ensure_authenticated(actor)
    friendship = repositories.get_friendship_by_id(int(friendship_id))
    if not friendship or friendship.status != Friendship.Status.PENDING:
        raise FriendNotFoundError("Заявка в ожидании не найдена")

    if not rules.can_decline_request(
        request_to_user_id=_friend_to_user_id(friendship),
        actor_id=actor.pk,
    ):
        raise FriendForbiddenError("Только получатель может отклонить эту заявку")

    friendship.status = Friendship.Status.DECLINED
    friendship.save(update_fields=["status", "updated_at"])

    audit_security_event(
        "friendship.declined",
        actor_user=actor,
        actor_user_id=actor.pk,
        actor_username=actor.username,
        is_authenticated=True,
        from_user_id=_friend_from_user_id(friendship),
    )
    return friendship


# ── Remove friend ─────────────────────────────────────────────────────

def remove_friend(actor, target_user_id: int) -> None:
    _ensure_authenticated(actor)
    target = repositories.get_user_by_id(int(target_user_id))
    if not target:
        raise FriendNotFoundError("Пользователь не найден")

    deleted = repositories.delete_friendship_pair(actor, target)
    if not deleted:
        raise FriendNotFoundError("Дружба не найдена")

    audit_security_event(
        "friendship.removed",
        actor_user=actor,
        actor_user_id=actor.pk,
        actor_username=actor.username,
        is_authenticated=True,
        target_user_id=target.pk,
        target_username=target.username,
    )


# ── Block / Unblock ──────────────────────────────────────────────────

def block_user(actor, target_username: str) -> Friendship:
    _ensure_authenticated(actor)
    username = _normalize_username(target_username)
    if not username:
        raise FriendServiceError("Требуется имя пользователя")

    target = repositories.get_user_by_username(username)
    if not target:
        raise FriendNotFoundError("Пользователь не найден")

    if rules.is_self_request(actor.pk, target.pk):
        raise FriendServiceError("Нельзя заблокировать самого себя")

    with transaction.atomic():
        # Remove any existing reverse friendship
        Friendship.objects.filter(from_user=target, to_user=actor).exclude(
            status=Friendship.Status.BLOCKED
        ).delete()
        # Create or update block
        friendship, _ = Friendship.objects.update_or_create(
            from_user=actor,
            to_user=target,
            defaults={"status": Friendship.Status.BLOCKED},
        )

    audit_security_event(
        "friendship.blocked",
        actor_user=actor,
        actor_user_id=actor.pk,
        actor_username=actor.username,
        is_authenticated=True,
        target_user_id=target.pk,
        target_username=target.username,
    )
    return friendship


def unblock_user(actor, target_user_id: int) -> None:
    _ensure_authenticated(actor)
    target = repositories.get_user_by_id(int(target_user_id))
    if not target:
        raise FriendNotFoundError("Пользователь не найден")

    friendship = repositories.get_friendship(actor, target)
    if not friendship or friendship.status != Friendship.Status.BLOCKED:
        raise FriendNotFoundError("Блокировка не найдена")

    friendship.delete()

    audit_security_event(
        "friendship.unblocked",
        actor_user=actor,
        actor_user_id=actor.pk,
        actor_username=actor.username,
        is_authenticated=True,
        target_user_id=target.pk,
        target_username=target.username,
    )
