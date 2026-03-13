"""Tests for auth API (email/password + session/csrf/rate-limit)."""

from __future__ import annotations

import json
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import make_password
from django.core.cache import cache
from django.test import Client, TestCase, override_settings

from users.application.errors import IdentityServiceError
from users.identity import ensure_profile
from users.models import EmailIdentity

User = get_user_model()


class AuthApiTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = Client(enforce_csrf_checks=True)

    def _csrf(self) -> str:
        response = self.client.get("/api/auth/csrf/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("csrftoken", response.cookies)
        return response.cookies["csrftoken"].value

    def _create_email_user(self, *, email: str, password: str):
        user = User.objects.create_user(username="tech_user", email=email)
        user.set_unusable_password()
        user.save(update_fields=["password"])
        EmailIdentity.objects.create(
            user=user,
            email_normalized=email.strip().lower(),
            password_hash=make_password(password),
        )
        return user

    def test_csrf_endpoint_returns_token(self):
        response = self.client.get("/api/auth/csrf/")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("csrfToken", payload)
        self.assertTrue(payload["csrfToken"])

    def test_register_success_email_contract(self):
        csrf = self._csrf()
        response = self.client.post(
            "/api/auth/register/",
            data=json.dumps(
                {
                    "email": "new@example.com",
                    "password1": "pass12345",
                    "password2": "pass12345",
                }
            ),
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(response.status_code, 201)
        payload = response.json()
        self.assertTrue(payload.get("authenticated"))
        self.assertEqual(payload.get("user", {}).get("email"), "new@example.com")
        self.assertIsNone(payload.get("user", {}).get("publicUsername"))

        identity = EmailIdentity.objects.get(email_normalized="new@example.com")
        profile = ensure_profile(identity.user)
        self.assertEqual(profile.name, "new")
        self.assertIsNone(profile.username)

    def test_register_duplicate_email_returns_conflict(self):
        self._create_email_user(email="taken@example.com", password="pass12345")
        csrf = self._csrf()
        response = self.client.post(
            "/api/auth/register/",
            data=json.dumps(
                {
                    "email": "taken@example.com",
                    "password1": "pass12345",
                    "password2": "pass12345",
                }
            ),
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(response.status_code, 409)
        payload = response.json()
        self.assertIn("errors", payload)
        self.assertIn("email", payload["errors"])

    @override_settings(
        AUTH_PASSWORD_VALIDATORS=[
            {
                "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
                "OPTIONS": {"min_length": 12},
            }
        ]
    )
    def test_register_weak_password_returns_password_error(self):
        csrf = self._csrf()
        response = self.client.post(
            "/api/auth/register/",
            data=json.dumps(
                {
                    "email": "weak@example.com",
                    "password1": "short1",
                    "password2": "short1",
                }
            ),
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertIn("errors", payload)
        self.assertIn("password", payload["errors"])

    def test_login_invalid_credentials(self):
        csrf = self._csrf()
        response = self.client.post(
            "/api/auth/login/",
            data=json.dumps({"email": "ghost@example.com", "password": "wrong"}),
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertIn("errors", payload)
        self.assertIn("credentials", payload["errors"])

    def test_login_success_and_session(self):
        self._create_email_user(email="login@example.com", password="pass12345")
        csrf = self._csrf()
        login_response = self.client.post(
            "/api/auth/login/",
            data=json.dumps({"email": "login@example.com", "password": "pass12345"}),
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(login_response.status_code, 200)
        self.assertTrue(login_response.json().get("authenticated"))

        session_response = self.client.get("/api/auth/session/")
        self.assertEqual(session_response.status_code, 200)
        payload = session_response.json()
        self.assertTrue(payload.get("authenticated"))
        self.assertEqual(payload.get("user", {}).get("email"), "login@example.com")

    @override_settings(AUTH_RATE_LIMIT=1, AUTH_RATE_WINDOW=60)
    def test_login_rate_limit(self):
        csrf = self._csrf()
        first = self.client.post(
            "/api/auth/login/",
            data=json.dumps({"email": "ghost@example.com", "password": "wrong"}),
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(first.status_code, 400)

        csrf = self._csrf()
        second = self.client.post(
            "/api/auth/login/",
            data=json.dumps({"email": "ghost@example.com", "password": "wrong"}),
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(second.status_code, 429)

    def test_password_rules_endpoint(self):
        response = self.client.get("/api/auth/password-rules/")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("rules", payload)
        self.assertIsInstance(payload["rules"], list)

    def test_presence_session_endpoint_initializes_session(self):
        response = self.client.get("/api/auth/presence-session/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get("ok"), True)
        self.assertIsNotNone(self.client.session.session_key)

    def test_login_failed_writes_security_audit_log(self):
        csrf = self._csrf()
        with self.assertLogs("security.audit", level="INFO") as captured:
            response = self.client.post(
                "/api/auth/login/",
                data=json.dumps({"email": "ghost@example.com", "password": "wrong"}),
                content_type="application/json",
                HTTP_X_CSRFTOKEN=csrf,
            )
        self.assertEqual(response.status_code, 400)
        self.assertTrue(any("auth.login.failed" in line for line in captured.output))

    def test_google_oauth_success(self):
        user = User.objects.create_user(username="google_user")
        profile = ensure_profile(user)
        profile.name = "Google User"
        profile.save(update_fields=["name"])

        csrf = self._csrf()
        with patch(
            "users.api.auth_service.authenticate_or_signup_with_google",
            return_value=user,
        ) as auth_mock:
            response = self.client.post(
                "/api/auth/oauth/google/",
                data=json.dumps({"idToken": "token-value"}),
                content_type="application/json",
                HTTP_X_CSRFTOKEN=csrf,
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload.get("authenticated"))
        self.assertEqual(payload.get("user", {}).get("name"), "Google User")
        auth_mock.assert_called_once_with(id_token="token-value", access_token="")

    def test_google_oauth_success_with_access_token(self):
        user = User.objects.create_user(username="google_user_access")
        profile = ensure_profile(user)
        profile.name = "Google User"
        profile.save(update_fields=["name"])

        csrf = self._csrf()
        with patch(
            "users.api.auth_service.authenticate_or_signup_with_google",
            return_value=user,
        ) as auth_mock:
            response = self.client.post(
                "/api/auth/oauth/google/",
                data=json.dumps({"accessToken": "token-value"}),
                content_type="application/json",
                HTTP_X_CSRFTOKEN=csrf,
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload.get("authenticated"))
        self.assertEqual(payload.get("user", {}).get("name"), "Google User")
        auth_mock.assert_called_once_with(id_token="", access_token="token-value")

    def test_google_oauth_service_error(self):
        csrf = self._csrf()
        with patch(
            "users.api.auth_service.authenticate_or_signup_with_google",
            side_effect=IdentityServiceError(
                "Google OAuth не настроен",
                code="oauth_not_configured",
                status_code=503,
            ),
        ):
            response = self.client.post(
                "/api/auth/oauth/google/",
                data=json.dumps({"idToken": "token-value"}),
                content_type="application/json",
                HTTP_X_CSRFTOKEN=csrf,
            )

        self.assertEqual(response.status_code, 503)
        payload = response.json()
        self.assertEqual(payload.get("code"), "oauth_not_configured")

    @override_settings(
        GOOGLE_OAUTH_CLIENT_ID="test-client-id.apps.googleusercontent.com"
    )
    def test_google_oauth_access_token_accepts_profile_and_email_scopes(self):
        class _MockResponse:
            def __init__(self, status_code, payload):
                self.status_code = status_code
                self._payload = payload

            def json(self):
                return self._payload

        def _mock_google_get(url, params=None, headers=None, timeout=0):
            if url.endswith("/tokeninfo"):
                return _MockResponse(
                    200,
                    {
                        "audience": "test-client-id.apps.googleusercontent.com",
                        "expires_in": "3599",
                        "scope": "email,profile",
                    },
                )
            if url.endswith("/userinfo"):
                return _MockResponse(
                    200,
                    {
                        "sub": "google-sub-123",
                        "email": "oauth-user@example.com",
                        "email_verified": True,
                        "name": "OAuth User",
                    },
                )
            return _MockResponse(404, {})

        csrf = self._csrf()
        with patch("users.application.auth_service.requests.get", side_effect=_mock_google_get):
            response = self.client.post(
                "/api/auth/oauth/google/",
                data=json.dumps({"accessToken": "token-value"}),
                content_type="application/json",
                HTTP_X_CSRFTOKEN=csrf,
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload.get("authenticated"))
        self.assertEqual(payload.get("user", {}).get("email"), "oauth-user@example.com")
