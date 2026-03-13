"""Users API: session, auth, profile and signed media endpoints."""

from __future__ import annotations

import time
from collections.abc import Mapping
from datetime import timedelta
from urllib.parse import quote

from django.conf import settings
from django.contrib.auth import login, logout, password_validation
from django.core.files.storage import default_storage
from django.db import OperationalError, ProgrammingError
from django.http import FileResponse, HttpResponse
from django.middleware.csrf import get_token
from django.utils import timezone
from django.utils.html import strip_tags
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from rest_framework.decorators import api_view
from rest_framework.exceptions import ParseError, UnsupportedMediaType
from rest_framework.response import Response

from chat_app_django.http_utils import error_response, parse_request_payload
from chat_app_django.ip_utils import get_client_ip_from_request
from chat_app_django.media_utils import (
    build_profile_url_from_request,
    is_valid_media_signature,
    normalize_media_path,
    serialize_avatar_crop,
)
from chat_app_django.security.audit import audit_http_event
from chat_app_django.security.rate_limit import DbRateLimiter, RateLimitPolicy

from users.application import auth_service
from users.application.errors import IdentityServiceError
from users.forms import ProfileUpdateForm
from users.identity import ensure_profile, normalize_public_username, user_public_username


AUTH_BACKEND_PATH = "users.auth_backends.EmailIdentityBackend"


def _extract_payload(request) -> Mapping[str, object]:
    try:
        data = getattr(request, "data", None)
    except (ParseError, UnsupportedMediaType):
        data = None
    if isinstance(data, Mapping):
        return data
    raw_request = getattr(request, "_request", request)
    return parse_request_payload(raw_request)


def _resolve_email(user) -> str:
    identity = getattr(user, "email_identity", None)
    if identity and getattr(identity, "email_normalized", None):
        return identity.email_normalized
    email_value = getattr(user, "email", "")
    return (email_value or "").strip().lower()


def _serialize_user(request, user):
    profile = ensure_profile(user)
    profile_image = None
    image = getattr(profile, "image", None)
    image_name = getattr(image, "name", "") if image else ""
    if image_name:
        profile_image = build_profile_url_from_request(request, image_name)

    last_seen = getattr(profile, "last_seen", None)
    public_username = normalize_public_username(getattr(profile, "username", None)) or None

    return {
        "id": user.pk,
        "name": (getattr(profile, "name", "") or "").strip(),
        "username": public_username,
        "publicUsername": public_username,
        "email": _resolve_email(user),
        "profileImage": profile_image,
        "avatarCrop": serialize_avatar_crop(profile),
        "bio": getattr(profile, "bio", "") or "",
        "lastSeen": last_seen.isoformat() if last_seen else None,
        "registeredAt": user.date_joined.isoformat() if getattr(user, "date_joined", None) else None,
    }


def _serialize_public_user(request, user):
    payload = _serialize_user(request, user)
    payload["email"] = ""
    return payload


def _get_client_ip(request) -> str:
    return get_client_ip_from_request(request) or ""


def _rate_limited(request, action: str) -> bool:
    limit = int(getattr(settings, "AUTH_RATE_LIMIT", 10))
    window = int(getattr(settings, "AUTH_RATE_WINDOW", 60))
    ip = _get_client_ip(request) or "unknown"
    scope_key = f"rl:auth:{action}:{ip}"
    policy = RateLimitPolicy(limit=limit, window_seconds=window)
    return DbRateLimiter.is_limited(scope_key=scope_key, policy=policy)


def _identity_error_response(exc: IdentityServiceError) -> Response:
    payload: dict[str, object] = {
        "error": exc.message,
        "code": exc.code,
    }
    if exc.errors:
        payload["errors"] = exc.errors
    return Response(payload, status=exc.status_code)


@ensure_csrf_cookie
@api_view(["GET"])
def csrf_token(request):
    return Response({"csrfToken": get_token(request)})


@ensure_csrf_cookie
@api_view(["GET"])
def session_view(request):
    user = getattr(request, "user", None)
    if user and user.is_authenticated:
        return Response({"authenticated": True, "user": _serialize_user(request, user)})
    return Response({"authenticated": False, "user": None})


@ensure_csrf_cookie
@api_view(["GET"])
def presence_session_view(request):
    if not request.session.session_key:
        request.session.create()
    request.session.modified = True
    audit_http_event("presence.session.bootstrap", request)
    return Response({"ok": True})


@csrf_protect
@api_view(["POST"])
def login_view(request):
    if _rate_limited(request, "login"):
        audit_http_event("auth.login.rate_limited", request)
        return error_response(status=429, error="Слишком много попыток")

    payload = _extract_payload(request)
    email = str(payload.get("email") or "").strip()
    password = str(payload.get("password") or "")

    if not email or not password:
        audit_http_event("auth.login.failed", request, reason="missing_credentials")
        return error_response(
            status=400,
            error="Укажите email и пароль",
            errors={"credentials": ["Укажите email и пароль"]},
        )

    try:
        user = auth_service.login_with_email(email, password)
    except IdentityServiceError as exc:
        audit_http_event("auth.login.failed", request, reason=exc.code)
        return _identity_error_response(exc)

    login(request, user, backend=AUTH_BACKEND_PATH)
    audit_http_event("auth.login.success", request, username=user_public_username(user))
    return Response({"authenticated": True, "user": _serialize_user(request, user)})


@csrf_protect
@api_view(["POST"])
def logout_view(request):
    user = getattr(request, "user", None)
    if user and user.is_authenticated:
        try:
            profile = ensure_profile(user)
            profile.last_seen = timezone.now() - timedelta(minutes=5)
            profile.save(update_fields=["last_seen"])
        except (OperationalError, ProgrammingError):
            pass

    logout(request)
    audit_http_event("auth.logout", request)
    return Response({"ok": True})


@csrf_protect
@api_view(["POST"])
def register_view(request):
    if _rate_limited(request, "register"):
        audit_http_event("auth.register.rate_limited", request)
        return error_response(status=429, error="Слишком много попыток")

    payload = _extract_payload(request)
    email = str(payload.get("email") or "").strip()
    password1 = str(payload.get("password1") or "")
    password2 = str(payload.get("password2") or "")

    try:
        user = auth_service.register_with_email(email, password1, password2)
    except IdentityServiceError as exc:
        audit_http_event("auth.register.failed", request, reason=exc.code)
        return _identity_error_response(exc)

    login(request, user, backend=AUTH_BACKEND_PATH)
    audit_http_event("auth.register.success", request, username=user_public_username(user))
    return Response({"authenticated": True, "user": _serialize_user(request, user)}, status=201)


@csrf_protect
@api_view(["POST"])
def oauth_google_view(request):
    payload = _extract_payload(request)
    id_token = str(payload.get("idToken") or "")
    access_token = str(payload.get("accessToken") or "")
    try:
        user = auth_service.authenticate_or_signup_with_google(
            id_token=id_token,
            access_token=access_token,
        )
    except IdentityServiceError as exc:
        audit_http_event("auth.oauth.google.failed", request, reason=exc.code)
        return _identity_error_response(exc)

    login(request, user, backend=AUTH_BACKEND_PATH)
    audit_http_event("auth.oauth.google.success", request, username=user_public_username(user))
    return Response({"authenticated": True, "user": _serialize_user(request, user)})


@api_view(["GET"])
def password_rules(request):
    return Response({"rules": password_validation.password_validators_help_texts()})


@api_view(["GET"])
def media_view(request, file_path: str):
    normalized_path = normalize_media_path(file_path)
    if not normalized_path:
        return Response({"error": "Не найдено"}, status=404)

    exp_raw = request.GET.get("exp")
    signature = request.GET.get("sig")
    try:
        expires_at = int(exp_raw)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        audit_http_event("media.signature.invalid", request, path=file_path, reason="invalid_exp")
        return Response({"error": "Доступ запрещен"}, status=403)

    now = int(time.time())
    if expires_at < now:
        audit_http_event("media.signature.expired", request, path=normalized_path)
        return Response({"error": "Доступ запрещен"}, status=403)

    if not is_valid_media_signature(normalized_path, expires_at, signature):
        audit_http_event("media.signature.invalid", request, path=normalized_path, reason="bad_signature")
        return Response({"error": "Доступ запрещен"}, status=403)

    if not default_storage.exists(normalized_path):
        return Response({"error": "Не найдено"}, status=404)

    cache_seconds = max(0, expires_at - now)
    if settings.DEBUG:
        response = FileResponse(default_storage.open(normalized_path, "rb"))
    else:
        response = HttpResponse()
        response["X-Accel-Redirect"] = f"/_protected_media/{quote(normalized_path, safe='/')}"

    response["Cache-Control"] = f"private, max-age={cache_seconds}"
    return response


@api_view(["GET"])
def public_profile_view(request, username: str):
    normalized = normalize_public_username(username)
    if not normalized:
        return Response({"error": "Не найдено"}, status=404)

    user = auth_service.get_user_by_username(normalized)
    if user is None:
        return Response({"error": "Не найдено"}, status=404)

    return Response({"user": _serialize_public_user(request, user)})


@csrf_protect
@api_view(["GET", "POST", "PATCH"])
def profile_view(request):
    user = getattr(request, "user", None)
    if not user or not user.is_authenticated:
        return error_response(status=401, error="Требуется авторизация")

    profile = ensure_profile(user)

    if request.method == "GET":
        return Response({"user": _serialize_user(request, user)})

    payload = _extract_payload(request)
    errors: dict[str, list[str]] = {}

    if "name" in payload:
        raw_name = str(payload.get("name") or "")
        next_name = strip_tags(raw_name).strip()
        if len(next_name) > 150:
            errors["name"] = ["Максимум 150 символов"]
        else:
            auth_service.set_profile_name(user, next_name)

    if "username" in payload:
        raw_username = payload.get("username")
        username_value: str | None
        if raw_username is None or isinstance(raw_username, str):
            username_value = raw_username
        else:
            username_value = str(raw_username)
        try:
            auth_service.set_username(user, username_value)
        except IdentityServiceError as exc:
            for field, field_errors in exc.errors.items():
                errors[field] = field_errors
            if not exc.errors:
                errors.setdefault("username", []).append(exc.message)

    media_form = ProfileUpdateForm(payload, request.FILES, instance=profile)
    if media_form.is_valid():
        media_form.save()
    else:
        form_errors = media_form.errors or {}
        for field, field_errors in form_errors.items():
            errors[field] = [str(error_item) for error_item in field_errors]

    if errors:
        audit_http_event("auth.profile.update.failed", request, username=user_public_username(user), errors=errors)
        return error_response(status=400, errors=errors)

    audit_http_event("auth.profile.update.success", request, username=user_public_username(user))
    return Response({"user": _serialize_user(request, user)})
