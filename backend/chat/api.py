from django.http import JsonResponse
from django.db import OperationalError, ProgrammingError, IntegrityError
from django.views.decorators.http import require_http_methods
from django.core.files.storage import default_storage
from django.conf import settings
from django.contrib.auth import get_user_model

from .constants import PUBLIC_ROOM_NAME, PUBLIC_ROOM_SLUG
from .models import Message, Room

User = get_user_model()


def _current_avatar_path(username: str) -> str | None:
    try:
        user = User.objects.select_related("profile").get(username=username)
        image = getattr(user.profile, "image", None)
        return image.name if image and image.name else None
    except Exception:
        return None


def _build_profile_pic_url(request, profile_pic, username: str | None = None):
    if not profile_pic:
        return None
    try:
        url = profile_pic.url
    except Exception:
        url = str(profile_pic)

    # Avoid double-prefixing if already absolute
    if url.startswith("http://") or url.startswith("https://"):
        return url

    media_prefix = settings.MEDIA_URL or "/media/"
    path = url
    if media_prefix and path.startswith(media_prefix):
        path = path[len(media_prefix):]
    path = path.lstrip("/")

    # Если файл отсутствует, попробуем взять актуальный путь из профиля
    if not default_storage.exists(path) and username:
        fresh_path = _current_avatar_path(username)
        if fresh_path and default_storage.exists(fresh_path):
            path = fresh_path

    # Если и сейчас нет, отдаем дефолт
    if not default_storage.exists(path):
        if default_storage.exists("default.jpg"):
            path = "default.jpg"
        else:
            return None

    absolute = f"{media_prefix.rstrip('/')}/{path}"
    try:
        return request.build_absolute_uri(absolute)
    except ValueError:
        return absolute


def _public_room():
    """
    Ensure the public room exists in the database.
    """
    try:
        room, _created = Room.objects.get_or_create(
            slug=PUBLIC_ROOM_SLUG,
            defaults={"name": PUBLIC_ROOM_NAME},
        )
        return room
    except (OperationalError, ProgrammingError, IntegrityError):
        # База может быть не готова (миграции не прогнаны) — вернем заглушку,
        # чтобы не ронять весь API.
        stub = Room(slug=PUBLIC_ROOM_SLUG, name=PUBLIC_ROOM_NAME)
        return stub


@require_http_methods(["GET"])
def public_room(request):
    room = _public_room()
    return JsonResponse({"slug": room.slug, "name": room.name})


@require_http_methods(["GET"])
def room_details(request, room_slug):
    if not request.user.is_authenticated and room_slug != PUBLIC_ROOM_SLUG:
        return JsonResponse({"error": "Требуется авторизация"}, status=401)

    try:
        room, _created = Room.objects.get_or_create(
            slug=room_slug,
            defaults={"name": room_slug},
        )
        return JsonResponse({"slug": room.slug, "name": room.name})
    except (OperationalError, ProgrammingError, IntegrityError):
        # Если таблицы нет или миграции не применены, вернем минимальные данные,
        # чтобы фронт продолжил работать.
        return JsonResponse({"slug": room_slug, "name": room_slug})


@require_http_methods(["GET"])
def room_messages(request, room_slug):
    if not request.user.is_authenticated and room_slug != PUBLIC_ROOM_SLUG:
        return JsonResponse({"error": "Требуется авторизация"}, status=401)
    try:
        messages = Message.objects.filter(room=room_slug).order_by("date_added")
        serialized = [
            {
                "id": message.id,
                "username": message.username,
                "content": message.message_content,
                "profilePic": _build_profile_pic_url(
                    request, message.profile_pic, username=message.username
                ),
                "createdAt": message.date_added.isoformat(),
            }
            for message in messages
        ]
        return JsonResponse({"messages": serialized})
    except (OperationalError, ProgrammingError):
        # Таблица не готова — вернем пустой список, чтобы не отдавать 500.
        return JsonResponse({"messages": []})
