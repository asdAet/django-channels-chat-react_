import re

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import IntegrityError, OperationalError, ProgrammingError
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from .constants import PUBLIC_ROOM_NAME, PUBLIC_ROOM_SLUG
from .models import Message, Room
from .utils import build_profile_url_from_request

User = get_user_model()


def _build_profile_pic_url(request, profile_pic):
    if not profile_pic:
        return None

    try:
        raw_value = profile_pic.url
    except (AttributeError, ValueError):
        raw_value = str(profile_pic)

    return build_profile_url_from_request(request, raw_value)


def _public_room():
    """Ensure the public room exists in the database."""
    try:
        room, _created = Room.objects.get_or_create(
            slug=PUBLIC_ROOM_SLUG,
            defaults={"name": PUBLIC_ROOM_NAME},
        )
        return room
    except (OperationalError, ProgrammingError, IntegrityError):
        return Room(slug=PUBLIC_ROOM_SLUG, name=PUBLIC_ROOM_NAME)


def _is_valid_room_slug(slug: str) -> bool:
    pattern = getattr(settings, "CHAT_ROOM_SLUG_REGEX", r"^[A-Za-z0-9_-]{3,50}$")
    try:
        return bool(re.match(pattern, slug or ""))
    except re.error:
        return False


def _parse_positive_int(raw_value: str | None, param_name: str) -> int:
    try:
        parsed = int(raw_value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        raise ValueError(f"Invalid '{param_name}': must be an integer")
    if parsed < 1:
        raise ValueError(f"Invalid '{param_name}': must be >= 1")
    return parsed


@require_http_methods(["GET"])
def public_room(request):
    room = _public_room()
    return JsonResponse({"slug": room.slug, "name": room.name})


@require_http_methods(["GET"])
def room_details(request, room_slug):
    if room_slug != PUBLIC_ROOM_SLUG and not _is_valid_room_slug(room_slug):
        return JsonResponse({"error": "Invalid room slug"}, status=400)

    if not request.user.is_authenticated and room_slug != PUBLIC_ROOM_SLUG:
        return JsonResponse({"error": "РўСЂРµР±СѓРµС‚СЃСЏ Р°РІС‚РѕСЂРёР·Р°С†РёСЏ"}, status=401)

    try:
        if room_slug == PUBLIC_ROOM_SLUG:
            room = _public_room()
            created = False
        else:
            existing = Room.objects.filter(slug=room_slug).first()
            if existing:
                if existing.created_by and existing.created_by != request.user:
                    return JsonResponse({"error": "Room slug is already taken"}, status=409)
                room = existing
                created = False
            else:
                room = Room.objects.create(
                    slug=room_slug,
                    name=f"{request.user.username}",
                    created_by=request.user,
                )
                created = True

        created_by = room.created_by.username if room.created_by else None
        return JsonResponse(
            {
                "slug": room.slug,
                "name": room.name,
                "created": created,
                "createdBy": created_by,
            }
        )
    except (OperationalError, ProgrammingError, IntegrityError):
        return JsonResponse(
            {
                "slug": room_slug,
                "name": room_slug,
                "created": True,
                "createdBy": None,
            }
        )


@require_http_methods(["GET"])
def room_messages(request, room_slug):
    if room_slug != PUBLIC_ROOM_SLUG and not _is_valid_room_slug(room_slug):
        return JsonResponse({"error": "Invalid room slug"}, status=400)

    if not request.user.is_authenticated and room_slug != PUBLIC_ROOM_SLUG:
        return JsonResponse({"error": "РўСЂРµР±СѓРµС‚СЃСЏ Р°РІС‚РѕСЂРёР·Р°С†РёСЏ"}, status=401)

    try:
        default_page_size = max(1, int(getattr(settings, "CHAT_MESSAGES_PAGE_SIZE", 50)))
        max_page_size = max(
            default_page_size,
            int(getattr(settings, "CHAT_MESSAGES_MAX_PAGE_SIZE", 200)),
        )

        limit_raw = request.GET.get("limit")
        before_raw = request.GET.get("before")

        if limit_raw is None:
            limit = default_page_size
        else:
            try:
                limit = _parse_positive_int(limit_raw, "limit")
            except ValueError as exc:
                return JsonResponse({"error": str(exc)}, status=400)
        limit = min(limit, max_page_size)

        before_id = None
        if before_raw is not None:
            try:
                before_id = _parse_positive_int(before_raw, "before")
            except ValueError as exc:
                return JsonResponse({"error": str(exc)}, status=400)

        messages_qs = Message.objects.filter(room=room_slug).select_related("user", "user__profile")
        if before_id is not None:
            messages_qs = messages_qs.filter(id__lt=before_id)

        batch = list(messages_qs.order_by("-id")[: limit + 1])
        has_more = len(batch) > limit
        if has_more:
            batch = batch[:limit]
        batch.reverse()

        next_before = batch[0].id if has_more and batch else None

        serialized = []
        for message in batch:
            user = getattr(message, "user", None)
            username = user.username if user else message.username

            profile_source = None
            if user:
                profile = getattr(user, "profile", None)
                image = getattr(profile, "image", None) if profile else None
                if image:
                    profile_source = image
            if not profile_source:
                profile_source = message.profile_pic

            profile_pic = _build_profile_pic_url(request, profile_source)

            serialized.append(
                {
                    "id": message.id,
                    "username": username,
                    "content": message.message_content,
                    "profilePic": profile_pic,
                    "createdAt": message.date_added.isoformat(),
                }
            )

        return JsonResponse(
            {
                "messages": serialized,
                "pagination": {
                    "limit": limit,
                    "hasMore": has_more,
                    "nextBefore": next_before,
                },
            }
        )
    except (OperationalError, ProgrammingError):
        return JsonResponse(
            {
                "messages": [],
                "pagination": {
                    "limit": int(getattr(settings, "CHAT_MESSAGES_PAGE_SIZE", 50)),
                    "hasMore": False,
                    "nextBefore": None,
                },
            }
        )


