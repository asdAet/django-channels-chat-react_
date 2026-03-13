"""Custom Django authentication backend for email/password identity."""

from __future__ import annotations

from django.contrib.auth.backends import BaseBackend
from django.contrib.auth.hashers import check_password
from django.contrib.auth.models import User

from .identity import normalize_email
from .models import EmailIdentity


class EmailIdentityBackend(BaseBackend):
    def authenticate(
        self,
        request,
        username: str | None = None,
        password: str | None = None,
        **kwargs,
    ):
        raw_email = kwargs.get("email", username)
        email_value = raw_email if isinstance(raw_email, str) else str(raw_email or "")
        normalized = normalize_email(email_value)
        if not normalized or not password:
            return None

        identity = (
            EmailIdentity.objects.select_related("user")
            .filter(email_normalized=normalized)
            .first()
        )
        if identity is None:
            return None
        if not check_password(password, identity.password_hash):
            return None
        return identity.user

    def get_user(self, user_id: int):
        return User.objects.filter(pk=user_id).first()
