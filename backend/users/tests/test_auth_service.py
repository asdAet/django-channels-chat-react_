"""Unit tests for users.application.auth_service (identity vNext)."""

from __future__ import annotations

import time
from unittest.mock import patch

import requests
from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from users.application import auth_service
from users.application.errors import IdentityConflictError, IdentityServiceError, IdentityUnauthorizedError
from users.identity import ensure_user_identity_core, user_public_ref
from users.models import EmailIdentity, LoginIdentity, OAuthIdentity

User = get_user_model()


class _MockResponse:
    def __init__(self, status_code: int, payload: dict):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


class AuthServiceUnitTests(TestCase):
    def setUp(self):
        self.user = auth_service.register_user(
            login="svc_login",
            password="pass12345",
            password_confirm="pass12345",
            name="Svc User",
            username="svcuser",
            email="svc@example.com",
        )

    def test_register_user_validates_required_fields_and_duplicates(self):
        with self.assertRaises(IdentityServiceError):
            auth_service.register_user(
                login="",
                password="pass12345",
                password_confirm="pass12345",
                name="User",
            )
        with self.assertRaises(IdentityServiceError):
            auth_service.register_user(
                login="new_login",
                password="",
                password_confirm="",
                name="User",
            )
        with self.assertRaises(IdentityServiceError):
            auth_service.register_user(
                login="new_login",
                password="pass12345",
                password_confirm="wrong",
                name="User",
            )
        with self.assertRaises(IdentityConflictError):
            auth_service.register_user(
                login="svc_login",
                password="pass12345",
                password_confirm="pass12345",
                name="User",
            )
        with self.assertRaises(IdentityConflictError):
            auth_service.register_user(
                login="new_login",
                password="pass12345",
                password_confirm="pass12345",
                name="User",
                email="svc@example.com",
            )

    def test_login_user_supports_login_and_email(self):
        self.assertEqual(auth_service.login_user("svc_login", "pass12345"), self.user)
        self.assertEqual(auth_service.login_user("svc@example.com", "pass12345"), self.user)

        with self.assertRaises(IdentityUnauthorizedError):
            auth_service.login_user("svc_login", "wrong")
        with self.assertRaises(IdentityUnauthorizedError):
            auth_service.login_user("missing", "pass12345")

    def test_login_user_supports_superuser_created_via_django_admin_flow(self):
        admin = User.objects.create_superuser(
            username="admin",
            email="admin@example.com",
            password="adminpass123",
        )
        self.assertFalse(LoginIdentity.objects.filter(user=admin).exists())

        self.assertEqual(auth_service.login_user("admin", "adminpass123"), admin)
        self.assertEqual(auth_service.login_user("admin@example.com", "adminpass123"), admin)

    def test_login_user_rejects_non_staff_without_identity_records(self):
        legacy_user = User.objects.create_user(
            username="legacy_user",
            email="legacy@example.com",
            password="legacypass123",
        )
        self.assertFalse(LoginIdentity.objects.filter(user=legacy_user).exists())

        with self.assertRaises(IdentityUnauthorizedError):
            auth_service.login_user("legacy_user", "legacypass123")

    @override_settings(GOOGLE_OAUTH_CLIENT_ID="")
    def test_get_expected_google_audience_requires_setting(self):
        with self.assertRaises(IdentityServiceError) as exc:
            auth_service._get_expected_google_audience()
        self.assertEqual(exc.exception.code, "oauth_not_configured")
        self.assertEqual(exc.exception.status_code, 503)

    def test_verify_google_id_token_requires_non_empty_token(self):
        with self.assertRaises(IdentityServiceError) as exc:
            auth_service._verify_google_id_token("")
        self.assertIn("idToken", exc.exception.errors)

    @override_settings(GOOGLE_OAUTH_CLIENT_ID="client-id")
    def test_verify_google_id_token_handles_transport_and_status_errors(self):
        with patch("users.application.auth_service.requests.get", side_effect=requests.RequestException):
            with self.assertRaises(IdentityServiceError) as exc:
                auth_service._verify_google_id_token("token")
            self.assertEqual(exc.exception.status_code, 503)

        with patch(
            "users.application.auth_service.requests.get",
            return_value=_MockResponse(400, {}),
        ):
            with self.assertRaises(IdentityUnauthorizedError):
                auth_service._verify_google_id_token("token")

    @override_settings(GOOGLE_OAUTH_CLIENT_ID="client-id")
    def test_verify_google_id_token_validates_payload_shape(self):
        base = {
            "iss": "https://accounts.google.com",
            "aud": "client-id",
            "exp": str(int(time.time()) + 3600),
            "email_verified": "true",
            "sub": "sub-1",
        }

        with patch(
            "users.application.auth_service.requests.get",
            return_value=_MockResponse(200, {**base, "iss": "https://bad.example.com"}),
        ):
            with self.assertRaises(IdentityUnauthorizedError):
                auth_service._verify_google_id_token("token")

        with patch(
            "users.application.auth_service.requests.get",
            return_value=_MockResponse(200, {**base, "aud": "other-client"}),
        ):
            with self.assertRaises(IdentityUnauthorizedError):
                auth_service._verify_google_id_token("token")

        with patch(
            "users.application.auth_service.requests.get",
            return_value=_MockResponse(200, {**base, "exp": "0"}),
        ):
            with self.assertRaises(IdentityUnauthorizedError):
                auth_service._verify_google_id_token("token")

        with patch(
            "users.application.auth_service.requests.get",
            return_value=_MockResponse(200, {**base, "email_verified": "false"}),
        ):
            with self.assertRaises(IdentityUnauthorizedError):
                auth_service._verify_google_id_token("token")

        with patch(
            "users.application.auth_service.requests.get",
            return_value=_MockResponse(200, {**base, "sub": ""}),
        ):
            with self.assertRaises(IdentityUnauthorizedError):
                auth_service._verify_google_id_token("token")

    @override_settings(GOOGLE_OAUTH_CLIENT_ID="client-id")
    def test_verify_google_access_token_validates_payload_and_enriches_userinfo(self):
        tokeninfo_payload = {
            "aud": "client-id",
            "expires_in": "3600",
            "user_id": "sub-access-1",
            "email_verified": "true",
        }
        userinfo_payload = {
            "sub": "sub-access-1",
            "email": "access@example.com",
            "name": "Access User",
            "picture": "https://example.com/access.png",
            "email_verified": True,
        }
        with patch(
            "users.application.auth_service.requests.get",
            side_effect=[
                _MockResponse(200, tokeninfo_payload),
                _MockResponse(200, userinfo_payload),
            ],
        ):
            payload = auth_service._verify_google_access_token("access-token")

        self.assertEqual(payload.get("sub"), "sub-access-1")
        self.assertEqual(payload.get("email"), "access@example.com")
        self.assertEqual(payload.get("name"), "Access User")

    @override_settings(GOOGLE_OAUTH_CLIENT_ID="client-id")
    def test_verify_google_access_token_rejects_invalid_audience(self):
        with patch(
            "users.application.auth_service.requests.get",
            return_value=_MockResponse(
                200,
                {
                    "aud": "other-client",
                    "expires_in": "3600",
                    "user_id": "sub-access-2",
                    "email_verified": "true",
                },
            ),
        ):
            with self.assertRaises(IdentityUnauthorizedError):
                auth_service._verify_google_access_token("access-token")

    @override_settings(GOOGLE_OAUTH_CLIENT_ID="client-id")
    def test_authenticate_or_signup_with_google_returns_existing_identity(self):
        OAuthIdentity.objects.create(
            user=self.user,
            provider=OAuthIdentity.Provider.GOOGLE,
            provider_user_id="sub-existing",
            email_from_provider="svc@example.com",
        )

        payload = {
            "iss": "https://accounts.google.com",
            "aud": "client-id",
            "exp": str(int(time.time()) + 3600),
            "email_verified": "true",
            "sub": "sub-existing",
            "email": "svc@example.com",
            "name": "Svc User",
        }
        with patch(
            "users.application.auth_service.requests.get",
            return_value=_MockResponse(200, payload),
        ):
            user = auth_service.authenticate_or_signup_with_google(id_token="token")
        self.assertEqual(user, self.user)

    @override_settings(GOOGLE_OAUTH_CLIENT_ID="client-id")
    def test_authenticate_or_signup_with_google_creates_user_and_checks_email_conflict(self):
        payload = {
            "iss": "https://accounts.google.com",
            "aud": "client-id",
            "exp": str(int(time.time()) + 3600),
            "email_verified": "true",
            "sub": "sub-new",
            "email": "new_oauth@example.com",
            "name": "New OAuth",
            "picture": "https://example.com/a.png",
        }
        with patch(
            "users.application.auth_service.requests.get",
            return_value=_MockResponse(200, payload),
        ):
            created = auth_service.authenticate_or_signup_with_google(id_token="token", username="newoauth")

        self.assertTrue(LoginIdentity.objects.filter(user=created).exists() is False)
        self.assertTrue(EmailIdentity.objects.filter(user=created, email_normalized="new_oauth@example.com").exists())
        self.assertTrue(OAuthIdentity.objects.filter(user=created, provider_user_id="sub-new").exists())
        self.assertEqual(user_public_ref(created), "@newoauth")
        self.assertTrue(ensure_user_identity_core(created).public_id)

        conflict_payload = {**payload, "sub": "sub-conflict", "email": "svc@example.com"}
        with patch(
            "users.application.auth_service.requests.get",
            return_value=_MockResponse(200, conflict_payload),
        ):
            with self.assertRaises(IdentityConflictError):
                auth_service.authenticate_or_signup_with_google(id_token="token")

    @override_settings(GOOGLE_OAUTH_CLIENT_ID="client-id")
    def test_authenticate_or_signup_with_google_supports_access_token(self):
        tokeninfo_payload = {
            "aud": "client-id",
            "expires_in": "3600",
            "user_id": "sub-access-new",
            "email_verified": "true",
        }
        userinfo_payload = {
            "sub": "sub-access-new",
            "email": "access_new@example.com",
            "name": "Access New",
            "picture": "https://example.com/access-new.png",
            "email_verified": True,
        }
        with patch(
            "users.application.auth_service.requests.get",
            side_effect=[
                _MockResponse(200, tokeninfo_payload),
                _MockResponse(200, userinfo_payload),
            ],
        ):
            created = auth_service.authenticate_or_signup_with_google(
                access_token="access-token",
                username="accessnew",
            )

        self.assertTrue(
            EmailIdentity.objects.filter(
                user=created,
                email_normalized="access_new@example.com",
            ).exists()
        )
        self.assertTrue(
            OAuthIdentity.objects.filter(
                user=created,
                provider=OAuthIdentity.Provider.GOOGLE,
                provider_user_id="sub-access-new",
            ).exists()
        )
        self.assertEqual(user_public_ref(created), "@accessnew")

    def test_set_public_handle_and_profile_name_helpers(self):
        self.assertIsNone(auth_service.set_public_handle(self.user, ""))
        handle = auth_service.set_public_handle(self.user, "validname")
        self.assertEqual(handle, "validname")

        with self.assertRaises(IdentityServiceError):
            auth_service.set_public_handle(self.user, "invalid name")

        display_name = auth_service.set_profile_name(self.user, " <b>Name</b> ")
        self.assertEqual(display_name, "Name")
        self.user.refresh_from_db()
        self.assertEqual(self.user.first_name, "Name")

    def test_update_security_settings_updates_email_and_password(self):
        auth_service.update_security_settings(self.user, email="new@example.com")
        self.assertTrue(EmailIdentity.objects.filter(user=self.user, email_normalized="new@example.com").exists())

        auth_service.update_security_settings(self.user, new_password="pass99999")
        self.assertEqual(auth_service.login_user("svc_login", "pass99999"), self.user)

    @override_settings(GOOGLE_OAUTH_CLIENT_ID="client-id")
    def test_oauth_user_without_email_must_add_email_before_setting_password(self):
        payload = {
            "iss": "https://accounts.google.com",
            "aud": "client-id",
            "exp": str(int(time.time()) + 3600),
            "email_verified": "true",
            "sub": "sub-no-email",
            "name": "OAuth No Email",
        }
        with patch(
            "users.application.auth_service.requests.get",
            return_value=_MockResponse(200, payload),
        ):
            oauth_user = auth_service.authenticate_or_signup_with_google(id_token="token")

        with self.assertRaises(IdentityServiceError) as exc:
            auth_service.update_security_settings(oauth_user, new_password="pass99999")
        self.assertEqual(exc.exception.code, "email_missing")

    def test_get_user_by_ref_returns_user_only_for_user_owner(self):
        auth_service.set_public_handle(self.user, "wrappedname")
        self.assertEqual(auth_service.get_user_by_ref("@wrappedname"), self.user)
        self.assertIsNone(auth_service.get_user_by_ref("@missing"))
