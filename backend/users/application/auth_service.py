"""Application services for auth and public identity management."""

from __future__ import annotations

import re
import time
from typing import Any

import requests
from django.conf import settings
from django.contrib.auth import password_validation
from django.contrib.auth.hashers import check_password, is_password_usable, make_password
from django.contrib.auth.models import AbstractUser, User
from django.db import IntegrityError, transaction
from django.utils.html import strip_tags

from users.identity import (
    ensure_profile,
    ensure_user_identity_core,
    generate_technical_username,
    normalize_email,
    normalize_login,
    resolve_public_ref,
    set_user_public_handle,
    user_public_ref,
    validate_login,
)
from users.models import EmailIdentity, LoginIdentity, OAuthIdentity

from .errors import IdentityConflictError, IdentityServiceError, IdentityUnauthorizedError

GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _invalid_credentials_error() -> IdentityUnauthorizedError:
    return IdentityUnauthorizedError("Неверный логин, email или пароль")


def _raise_handle_validation_or_conflict(exc: ValueError) -> None:
    message = str(exc)
    errors = {"username": [message]}
    if message == "Этот username уже занят":
        raise IdentityConflictError(message, code="username_taken", errors=errors) from exc
    raise IdentityServiceError(message, code="invalid_username", errors=errors) from exc


def _normalize_name(name: str | None) -> str:
    value = strip_tags(str(name or "")).strip()
    return value


def _normalize_optional_email(email: str | None) -> str | None:
    normalized = normalize_email(email)
    return normalized or None


def _email_local_part(email: str) -> str:
    local = (email.split("@", 1)[0] if "@" in email else email).strip()
    return local or "user"


def _looks_like_email(identifier: str) -> bool:
    return bool(_EMAIL_RE.fullmatch(identifier))


def _authenticate_legacy_admin(identifier: str, password: str) -> User | None:
    """
    Allow Django-admin accounts created via `createsuperuser` to use API login.

    Such accounts may not have LoginIdentity/EmailIdentity rows, but can still
    be authenticated by Django's password hash on User model.
    """
    if _looks_like_email(identifier):
        user = User.objects.filter(email__iexact=identifier).first()
    else:
        user = User.objects.filter(username__iexact=identifier).first()

    if user is None or not user.is_active:
        return None
    if not (user.is_staff or user.is_superuser):
        return None
    if not user.check_password(password):
        return None
    return user


def _ensure_login_identity(user: AbstractUser) -> LoginIdentity:
    existing = getattr(user, "login_identity", None)
    if existing is not None:
        return existing

    core = ensure_user_identity_core(user)
    base_login = f"u{core.public_id}"
    candidate = base_login
    suffix = 0
    while LoginIdentity.objects.filter(login_normalized=candidate).exists():
        suffix += 1
        candidate = f"{base_login}_{suffix}"

    return LoginIdentity.objects.create(
        user=user,
        login_normalized=candidate,
        password_hash=make_password(None),
    )


def _set_email_identity(user: AbstractUser, email_value: str | None, *, verified: bool = False) -> None:
    if email_value is None:
        EmailIdentity.objects.filter(user=user).delete()
        return

    existing = EmailIdentity.objects.filter(email_normalized=email_value).exclude(user=user).exists()
    if existing:
        raise IdentityConflictError(
            "Эта почта уже используется",
            code="email_taken",
            errors={"email": ["Эта почта уже используется"]},
        )

    EmailIdentity.objects.update_or_create(
        user=user,
        defaults={
            "email_normalized": email_value,
            "email_verified": bool(verified),
        },
    )


def register_user(
    login: str,
    password: str,
    password_confirm: str,
    name: str,
    username: str | None = None,
    email: str | None = None,
) -> User:
    try:
        normalized_login = validate_login(login)
    except ValueError as exc:
        raise IdentityServiceError(str(exc), errors={"login": [str(exc)]}) from exc
    normalized_name = _normalize_name(name)
    normalized_email = _normalize_optional_email(email)

    if not normalized_name:
        raise IdentityServiceError("Укажите name", errors={"name": ["Укажите name"]})

    if not password or not password_confirm:
        raise IdentityServiceError("Укажите пароль", errors={"password": ["Укажите пароль"]})
    if password != password_confirm:
        raise IdentityServiceError("Пароли не совпадают", errors={"passwordConfirm": ["Пароли не совпадают"]})

    probe_user = User(username=normalized_login, first_name=normalized_name, email=normalized_email or "")
    try:
        password_validation.validate_password(password, user=probe_user)
    except Exception as exc:  # noqa: BLE001
        errors = list(getattr(exc, "messages", [])) or ["Пароль слишком слабый"]
        raise IdentityServiceError("Пароль слишком слабый", errors={"password": [str(item) for item in errors]})

    if LoginIdentity.objects.filter(login_normalized=normalized_login).exists():
        raise IdentityConflictError(
            "Этот логин уже занят",
            code="login_taken",
            errors={"login": ["Этот логин уже занят"]},
        )

    if normalized_email and EmailIdentity.objects.filter(email_normalized=normalized_email).exists():
        raise IdentityConflictError(
            "Эта почта уже используется",
            code="email_taken",
            errors={"email": ["Эта почта уже используется"]},
        )

    technical_username = generate_technical_username(normalized_login)

    try:
        with transaction.atomic():
            user = User.objects.create(
                username=technical_username,
                first_name=normalized_name,
                email=normalized_email or "",
            )
            user.set_unusable_password()
            user.save(update_fields=["password"])

            ensure_user_identity_core(user)
            profile = ensure_profile(user)
            profile.name = normalized_name
            profile.save(update_fields=["name"])

            LoginIdentity.objects.create(
                user=user,
                login_normalized=normalized_login,
                password_hash=make_password(password),
            )

            if normalized_email:
                _set_email_identity(user, normalized_email, verified=False)

            if username is not None:
                try:
                    set_user_public_handle(user, username)
                except ValueError as exc:
                    _raise_handle_validation_or_conflict(exc)
    except IntegrityError as exc:
        raise IdentityConflictError("Конфликт уникальности при регистрации") from exc

    return user


def login_user(identifier: str, password: str) -> User:
    normalized_identifier = str(identifier or "").strip().lower()
    if not normalized_identifier or not password:
        raise _invalid_credentials_error()

    identity: LoginIdentity | None = None

    if _looks_like_email(normalized_identifier):
        email_identity = (
            EmailIdentity.objects.select_related("user", "user__login_identity", "user__profile")
            .filter(email_normalized=normalized_identifier)
            .first()
        )
        if email_identity is not None:
            identity = getattr(email_identity.user, "login_identity", None)
    else:
        login_value = normalize_login(normalized_identifier)
        identity = (
            LoginIdentity.objects.select_related("user", "user__profile")
            .filter(login_normalized=login_value)
            .first()
        )

    if identity is None:
        legacy_admin = _authenticate_legacy_admin(normalized_identifier, password)
        if legacy_admin is not None:
            return legacy_admin
        raise _invalid_credentials_error()

    if not check_password(password, identity.password_hash):
        raise _invalid_credentials_error()

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

    audience = str(tokeninfo_payload.get("aud") or "")
    if audience != expected_audience:
        raise IdentityUnauthorizedError("Невалидный Google токен")

    try:
        expires_in = int(tokeninfo_payload.get("expires_in") or "0")
    except (TypeError, ValueError):
        expires_in = 0
    if expires_in <= 0:
        raise IdentityUnauthorizedError("Невалидный Google токен")

    provider_user_id = str(
        tokeninfo_payload.get("sub")
        or tokeninfo_payload.get("user_id")
        or "",
    ).strip()
    if not provider_user_id:
        raise IdentityUnauthorizedError("Невалидный Google токен")

    try:
        userinfo_response = requests.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {token}"},
            timeout=5,
        )
        userinfo_payload = userinfo_response.json() if userinfo_response.status_code == 200 else {}
    except requests.RequestException:
        userinfo_payload = {}

    payload = {
        **tokeninfo_payload,
        **userinfo_payload,
    }

    payload["sub"] = str(payload.get("sub") or provider_user_id).strip()
    email_verified = str(payload.get("email_verified") or "").lower() in {"true", "1"}
    if not email_verified:
        raise IdentityUnauthorizedError("Email в Google не подтвержден")

    return payload


def authenticate_or_signup_with_google(
    *,
    id_token: str | None = None,
    access_token: str | None = None,
    username: str | None = None,
) -> User:
    normalized_id_token = str(id_token or "").strip()
    normalized_access_token = str(access_token or "").strip()
    if normalized_id_token:
        payload = _verify_google_id_token(normalized_id_token)
    elif normalized_access_token:
        payload = _verify_google_access_token(normalized_access_token)
    else:
        raise IdentityServiceError(
            "Требуется idToken или accessToken",
            errors={"idToken": ["Требуется idToken или accessToken"]},
        )
    provider_user_id = str(payload.get("sub") or "").strip()

    identity = (
        OAuthIdentity.objects.select_related("user", "user__profile")
        .filter(provider=OAuthIdentity.Provider.GOOGLE, provider_user_id=provider_user_id)
        .first()
    )
    if identity is not None:
        return identity.user

    normalized_email = normalize_email(str(payload.get("email") or "").strip())
    name_from_provider = _normalize_name(str(payload.get("name") or ""))
    avatar_url = str(payload.get("picture") or "").strip()
    display_name = name_from_provider or _email_local_part(normalized_email)

    if normalized_email and EmailIdentity.objects.filter(email_normalized=normalized_email).exists():
        raise IdentityConflictError(
            "Эта почта уже используется",
            code="email_taken",
            errors={"email": ["Эта почта уже используется"]},
        )

    with transaction.atomic():
        technical_username = generate_technical_username(display_name)
        user = User.objects.create(
            username=technical_username,
            first_name=display_name,
            email=normalized_email,
        )
        user.set_unusable_password()
        user.save(update_fields=["password"])

        ensure_user_identity_core(user)
        profile = ensure_profile(user)
        profile.name = display_name
        profile.avatar_url = avatar_url
        profile.save(update_fields=["name", "avatar_url"])

        OAuthIdentity.objects.create(
            user=user,
            provider=OAuthIdentity.Provider.GOOGLE,
            provider_user_id=provider_user_id,
            email_from_provider=normalized_email,
            name_from_provider=display_name,
            avatar_url_from_provider=avatar_url,
        )

        if normalized_email:
            _set_email_identity(user, normalized_email, verified=True)

        if username is not None:
            try:
                set_user_public_handle(user, username)
            except ValueError as exc:
                _raise_handle_validation_or_conflict(exc)

    return user


def set_profile_name(user: AbstractUser, name: str | None) -> str:
    profile = ensure_profile(user)
    next_name = _normalize_name(name)
    if getattr(user, "first_name", "") != next_name:
        user.first_name = next_name
        user.save(update_fields=["first_name"])
    profile.name = next_name
    profile.save(update_fields=["name"])
    return next_name


def set_public_handle(user: AbstractUser, username: str | None) -> str | None:
    try:
        return set_user_public_handle(user, username)
    except ValueError as exc:
        _raise_handle_validation_or_conflict(exc)


def _unlink_oauth_provider(user: AbstractUser, provider: str) -> None:
    normalized_provider = str(provider or "").strip().lower()
    if not normalized_provider:
        raise IdentityServiceError(
            "Укажите OAuth provider",
            errors={"unlinkOAuthProvider": ["Укажите OAuth provider"]},
        )

    allowed_providers = {choice[0] for choice in OAuthIdentity.Provider.choices}
    if normalized_provider not in allowed_providers:
        raise IdentityServiceError(
            "Неподдерживаемый OAuth provider",
            errors={"unlinkOAuthProvider": ["Неподдерживаемый OAuth provider"]},
        )

    identity = OAuthIdentity.objects.filter(user=user, provider=normalized_provider).first()
    if identity is None:
        raise IdentityServiceError(
            "OAuth provider не привязан",
            code="oauth_provider_not_linked",
            status_code=404,
            errors={"unlinkOAuthProvider": ["OAuth provider не привязан"]},
        )

    login_identity = getattr(user, "login_identity", None)
    has_password = bool(login_identity and is_password_usable(login_identity.password_hash))
    has_other_oauth = OAuthIdentity.objects.filter(user=user).exclude(pk=identity.pk).exists()
    if not has_password and not has_other_oauth:
        raise IdentityServiceError(
            "Нельзя отвязать последний способ входа",
            code="last_auth_method",
            errors={"unlinkOAuthProvider": ["Нельзя отвязать последний способ входа"]},
        )

    identity.delete()


def get_security_settings(user: AbstractUser) -> dict[str, Any]:
    email_identity = getattr(user, "email_identity", None)
    login_identity = getattr(user, "login_identity", None)

    oauth_providers = list(
        OAuthIdentity.objects.filter(user=user).order_by("provider").values_list("provider", flat=True)
    )

    return {
        "email": getattr(email_identity, "email_normalized", None) or None,
        "emailVerified": bool(getattr(email_identity, "email_verified", False)),
        "hasPassword": bool(login_identity and is_password_usable(login_identity.password_hash)),
        "oauthProviders": oauth_providers,
    }


def update_security_settings(
    user: AbstractUser,
    *,
    email: str | None = None,
    verify_email: bool | None = None,
    new_password: str | None = None,
    unlink_oauth_provider: str | None = None,
) -> None:
    if email is not None:
        normalized_email = _normalize_optional_email(email)
        _set_email_identity(user, normalized_email, verified=False)
        user.email = normalized_email or ""
        user.save(update_fields=["email"])

    if verify_email:
        email_identity = getattr(user, "email_identity", None)
        if email_identity is None or not getattr(email_identity, "email_normalized", None):
            raise IdentityServiceError(
                "Сначала добавьте email",
                code="email_missing",
                errors={"email": ["Сначала добавьте email"]},
            )
        if not email_identity.email_verified:
            email_identity.email_verified = True
            email_identity.save(update_fields=["email_verified", "updated_at"])

    if unlink_oauth_provider is not None:
        _unlink_oauth_provider(user, unlink_oauth_provider)

    if new_password is not None:
        if not str(new_password):
            raise IdentityServiceError("Укажите newPassword", errors={"newPassword": ["Укажите newPassword"]})

        try:
            password_validation.validate_password(str(new_password), user=user)
        except Exception as exc:  # noqa: BLE001
            messages = list(getattr(exc, "messages", [])) or ["Пароль слишком слабый"]
            raise IdentityServiceError(
                "Пароль слишком слабый",
                errors={"newPassword": [str(item) for item in messages]},
            ) from exc

        login_identity = getattr(user, "login_identity", None)
        has_usable_password = bool(login_identity and is_password_usable(login_identity.password_hash))
        has_oauth = OAuthIdentity.objects.filter(user=user).exists()
        has_email = bool(
            getattr(getattr(user, "email_identity", None), "email_normalized", None)
        )
        if has_oauth and not has_usable_password and not has_email:
            raise IdentityServiceError(
                "Сначала добавьте email",
                code="email_missing",
                errors={"email": ["Сначала добавьте email"]},
            )

        login_identity = _ensure_login_identity(user)
        login_identity.password_hash = make_password(str(new_password))
        login_identity.save(update_fields=["password_hash", "updated_at"])


def get_user_by_ref(ref: str):
    owner_type, owner = resolve_public_ref(ref)
    if owner_type == "user":
        return owner
    return None
