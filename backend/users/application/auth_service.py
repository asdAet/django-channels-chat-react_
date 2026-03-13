"""Application services for auth and public identity management."""

from __future__ import annotations

import time
import re
from typing import Any

import requests
from django.conf import settings
from django.contrib.auth import password_validation
from django.contrib.auth.hashers import check_password, make_password
from django.contrib.auth.models import AbstractUser, User
from django.db import IntegrityError, transaction
from django.utils.html import strip_tags

from users.identity import (
    ensure_profile,
    generate_technical_username,
    get_user_by_public_username,
    normalize_email,
    validate_public_username,
)
from users.models import EmailIdentity, OAuthIdentity

from .errors import (
    IdentityConflictError,
    IdentityServiceError,
    IdentityUnauthorizedError,
)

GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo"
GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
GOOGLE_REQUIRED_SCOPES = {"openid", "profile", "email"}
GOOGLE_REQUIRED_ACCESS_TOKEN_SCOPES = {"profile", "email"}
GOOGLE_SCOPE_ALIASES = {
    "openid": "openid",
    "profile": "profile",
    "email": "email",
    "https://www.googleapis.com/auth/userinfo.profile": "profile",
    "https://www.googleapis.com/auth/userinfo.email": "email",
}


def _email_local_part(email: str) -> str:
    local = (email.split("@", 1)[0] if "@" in email else email).strip()
    return local or "user"


def _resolve_google_audience(payload: dict[str, Any]) -> str:
    for key in ("aud", "audience", "issued_to", "azp"):
        candidate = str(payload.get(key) or "").strip()
        if candidate:
            return candidate
    return ""


def _normalize_google_scopes(scope_raw: str) -> set[str]:
    normalized: set[str] = set()
    for scope in re.split(r"[\s,]+", scope_raw):
        value = scope.strip().lower()
        if not value:
            continue
        normalized.add(GOOGLE_SCOPE_ALIASES.get(value, value))
    return normalized


def register_with_email(email: str, password1: str, password2: str) -> User:
    normalized_email = normalize_email(email)
    if not normalized_email:
        raise IdentityServiceError(
            "Укажите email",
            errors={"email": ["Укажите email"]},
        )

    if not password1 or not password2:
        raise IdentityServiceError(
            "Укажите пароль",
            errors={"password": ["Укажите пароль"]},
        )

    if password1 != password2:
        raise IdentityServiceError(
            "Пароли не совпадают",
            errors={"password": ["Пароли не совпадают"]},
        )

    if EmailIdentity.objects.filter(email_normalized=normalized_email).exists():
        raise IdentityConflictError(
            "Email уже используется",
            errors={"email": ["Email уже используется"]},
        )

    probe_user = User(email=normalized_email, username="temp")
    try:
        password_validation.validate_password(password1, user=probe_user)
    except Exception as exc:
        message = "Пароль слишком слабый"
        errors = getattr(exc, "messages", [message])
        raise IdentityServiceError(message, errors={"password": list(errors)})

    local_part = _email_local_part(normalized_email)

    try:
        with transaction.atomic():
            technical_username = generate_technical_username(local_part)
            user = User.objects.create(
                username=technical_username,
                email=normalized_email,
                first_name=local_part,
            )
            user.set_unusable_password()
            user.save(update_fields=["password"])

            profile = ensure_profile(user)
            profile.name = local_part
            profile.username = None
            profile.save(update_fields=["name", "username"])

            EmailIdentity.objects.create(
                user=user,
                email_normalized=normalized_email,
                email_verified=False,
                password_hash=make_password(password1),
            )
    except IntegrityError:
        raise IdentityConflictError(
            "Email уже используется",
            errors={"email": ["Email уже используется"]},
        )

    return user


def login_with_email(email: str, password: str) -> User:
    normalized_email = normalize_email(email)
    if not normalized_email or not password:
        raise IdentityUnauthorizedError()

    identity = (
        EmailIdentity.objects.select_related("user", "user__profile")
        .filter(email_normalized=normalized_email)
        .first()
    )
    if identity is None:
        raise IdentityUnauthorizedError()

    if not check_password(password, identity.password_hash):
        raise IdentityUnauthorizedError()

    return identity.user


def _get_expected_google_audience() -> str:
    expected_audience = str(getattr(settings, "GOOGLE_OAUTH_CLIENT_ID", "") or "").strip()
    if not expected_audience:
        raise IdentityServiceError(
            "Google OAuth не настроен",
            code="oauth_not_configured",
            status_code=503,
        )
    return expected_audience


def _verify_google_id_token(id_token: str) -> dict[str, Any]:
    token = (id_token or "").strip()
    if not token:
        raise IdentityServiceError(
            "Требуется idToken",
            errors={"idToken": ["Требуется idToken"]},
        )

    expected_audience = _get_expected_google_audience()

    try:
        response = requests.get(
            GOOGLE_TOKENINFO_URL,
            params={"id_token": token},
            timeout=5,
        )
    except requests.RequestException:
        raise IdentityServiceError(
            "Google OAuth временно недоступен",
            code="oauth_unavailable",
            status_code=503,
        )

    if response.status_code != 200:
        raise IdentityUnauthorizedError("Невалидный Google токен")

    payload = response.json()

    issuer = str(payload.get("iss") or "")
    if issuer not in {"accounts.google.com", "https://accounts.google.com"}:
        raise IdentityUnauthorizedError("Невалидный Google токен")

    audience = str(payload.get("aud") or "")
    if audience != expected_audience:
        raise IdentityUnauthorizedError("Невалидный Google токен")

    try:
        expires_at = int(payload.get("exp") or "0")
    except (TypeError, ValueError):
        expires_at = 0
    if expires_at <= int(time.time()):
        raise IdentityUnauthorizedError("Невалидный Google токен")

    email_verified = str(payload.get("email_verified") or "").lower() in {"true", "1"}
    if not email_verified:
        raise IdentityUnauthorizedError("Email в Google не подтвержден")

    provider_user_id = str(payload.get("sub") or "").strip()
    if not provider_user_id:
        raise IdentityUnauthorizedError("Невалидный Google токен")

    return payload


def _verify_google_access_token(access_token: str) -> dict[str, Any]:
    token = (access_token or "").strip()
    if not token:
        raise IdentityServiceError(
            "Требуется accessToken",
            errors={"accessToken": ["Требуется accessToken"]},
        )

    expected_audience = _get_expected_google_audience()

    try:
        tokeninfo_response = requests.get(
            GOOGLE_TOKENINFO_URL,
            params={"access_token": token},
            timeout=5,
        )
    except requests.RequestException:
        raise IdentityServiceError(
            "Google OAuth временно недоступен",
            code="oauth_unavailable",
            status_code=503,
        )

    if tokeninfo_response.status_code != 200:
        raise IdentityUnauthorizedError("Невалидный Google токен")

    tokeninfo_payload = tokeninfo_response.json()

    audience = _resolve_google_audience(tokeninfo_payload)
    if audience != expected_audience:
        raise IdentityUnauthorizedError("Невалидный Google токен")

    try:
        expires_in = int(tokeninfo_payload.get("expires_in") or "0")
    except (TypeError, ValueError):
        expires_in = 0
    if expires_in <= 0:
        raise IdentityUnauthorizedError("Невалидный Google токен")

    scopes = _normalize_google_scopes(str(tokeninfo_payload.get("scope") or ""))
    # Google tokeninfo for access tokens may omit `openid` (or even `scope`),
    # while userinfo still proves granted identity scopes.
    if scopes and not GOOGLE_REQUIRED_ACCESS_TOKEN_SCOPES.issubset(scopes):
        raise IdentityUnauthorizedError("Недостаточно прав Google токена")

    try:
        userinfo_response = requests.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {token}"},
            timeout=5,
        )
    except requests.RequestException:
        raise IdentityServiceError(
            "Google OAuth временно недоступен",
            code="oauth_unavailable",
            status_code=503,
        )

    if userinfo_response.status_code != 200:
        raise IdentityUnauthorizedError("Невалидный Google токен")

    payload = userinfo_response.json()

    provider_user_id = str(payload.get("sub") or "").strip()
    if not provider_user_id:
        raise IdentityUnauthorizedError("Невалидный Google токен")

    email_verified = payload.get("email_verified")
    email_verified_bool = bool(email_verified is True or str(email_verified).lower() in {"true", "1"})
    if not email_verified_bool:
        raise IdentityUnauthorizedError("Email в Google не подтвержден")

    raw_email = str(payload.get("email") or "").strip()
    normalized_email = normalize_email(raw_email)
    if not normalized_email:
        raise IdentityUnauthorizedError("Невалидный Google токен")

    merged_payload = dict(payload)
    merged_payload["sub"] = provider_user_id
    merged_payload["email"] = normalized_email
    merged_payload["email_verified"] = True
    if not str(merged_payload.get("name") or "").strip():
        given_name = str(merged_payload.get("given_name") or "").strip()
        family_name = str(merged_payload.get("family_name") or "").strip()
        merged_payload["name"] = " ".join(part for part in [given_name, family_name] if part).strip()

    return merged_payload


def _verify_google_token(*, id_token: str = "", access_token: str = "") -> dict[str, Any]:
    normalized_access_token = (access_token or "").strip()
    normalized_id_token = (id_token or "").strip()
    if normalized_access_token:
        return _verify_google_access_token(normalized_access_token)
    if normalized_id_token:
        return _verify_google_id_token(normalized_id_token)
    raise IdentityServiceError(
        "Требуется accessToken или idToken",
        errors={
            "accessToken": ["Требуется accessToken или idToken"],
            "idToken": ["Требуется accessToken или idToken"],
        },
    )


def signup_with_google(id_token: str = "", access_token: str = "") -> User:
    payload = _verify_google_token(id_token=id_token, access_token=access_token)

    provider_user_id = str(payload.get("sub") or "").strip()
    existing = OAuthIdentity.objects.select_related("user").filter(
        provider=OAuthIdentity.Provider.GOOGLE,
        provider_user_id=provider_user_id,
    ).first()
    if existing is not None:
        raise IdentityConflictError("Google-аккаунт уже привязан")

    raw_email = str(payload.get("email") or "").strip()
    normalized_email = normalize_email(raw_email)
    name_from_provider = strip_tags(str(payload.get("name") or "").strip())
    display_name = name_from_provider or _email_local_part(normalized_email)

    with transaction.atomic():
        technical_username = generate_technical_username(display_name)
        user = User.objects.create(
            username=technical_username,
            email=normalized_email,
            first_name=display_name,
        )
        user.set_unusable_password()
        user.save(update_fields=["password"])

        profile = ensure_profile(user)
        profile.name = display_name
        profile.username = None
        profile.save(update_fields=["name", "username"])

        OAuthIdentity.objects.create(
            user=user,
            provider=OAuthIdentity.Provider.GOOGLE,
            provider_user_id=provider_user_id,
            email_from_provider=normalized_email,
        )

    return user


def login_with_google(id_token: str = "", access_token: str = "") -> User:
    payload = _verify_google_token(id_token=id_token, access_token=access_token)
    provider_user_id = str(payload.get("sub") or "").strip()

    identity = (
        OAuthIdentity.objects.select_related("user", "user__profile")
        .filter(
            provider=OAuthIdentity.Provider.GOOGLE,
            provider_user_id=provider_user_id,
        )
        .first()
    )
    if identity is None:
        raise IdentityUnauthorizedError("Google-аккаунт не зарегистрирован")
    return identity.user


def authenticate_or_signup_with_google(id_token: str = "", access_token: str = "") -> User:
    payload = _verify_google_token(id_token=id_token, access_token=access_token)
    provider_user_id = str(payload.get("sub") or "").strip()

    identity = (
        OAuthIdentity.objects.select_related("user", "user__profile")
        .filter(
            provider=OAuthIdentity.Provider.GOOGLE,
            provider_user_id=provider_user_id,
        )
        .first()
    )
    if identity is not None:
        return identity.user

    raw_email = str(payload.get("email") or "").strip()
    normalized_email = normalize_email(raw_email)
    name_from_provider = strip_tags(str(payload.get("name") or "").strip())
    display_name = name_from_provider or _email_local_part(normalized_email)

    with transaction.atomic():
        technical_username = generate_technical_username(display_name)
        user = User.objects.create(
            username=technical_username,
            email=normalized_email,
            first_name=display_name,
        )
        user.set_unusable_password()
        user.save(update_fields=["password"])

        profile = ensure_profile(user)
        profile.name = display_name
        profile.username = None
        profile.save(update_fields=["name", "username"])

        OAuthIdentity.objects.create(
            user=user,
            provider=OAuthIdentity.Provider.GOOGLE,
            provider_user_id=provider_user_id,
            email_from_provider=normalized_email,
        )

    return user


def set_username(user: AbstractUser, username: str | None) -> str | None:
    profile = ensure_profile(user)

    if username is None or not str(username).strip():
        profile.username = None
        profile.save(update_fields=["username"])
        return None

    try:
        normalized = validate_public_username(username)
    except ValueError as exc:
        raise IdentityServiceError(
            str(exc),
            errors={"username": [str(exc)]},
        )

    previous_username = profile.username
    profile.username = normalized
    try:
        with transaction.atomic():
            profile.save(update_fields=["username"])
    except IntegrityError:
        profile.username = previous_username
        raise IdentityConflictError(
            "Имя пользователя уже занято",
            errors={"username": ["Имя пользователя уже занято"]},
        )
    return normalized


def set_profile_name(user: AbstractUser, name: str | None) -> str:
    profile = ensure_profile(user)
    next_name = strip_tags((name or "").strip())
    profile.name = next_name
    profile.save(update_fields=["name"])
    return next_name


def get_user_by_username(username: str):
    return get_user_by_public_username(username)
