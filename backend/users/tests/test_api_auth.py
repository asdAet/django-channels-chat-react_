"""Tests for auth API (identity vNext contract)."""

from __future__ import annotations

import json
from unittest.mock import patch

from django.core.cache import cache
from django.test import Client, TestCase, override_settings

from users.application import auth_service
from users.application.errors import IdentityServiceError
from users.models import EmailIdentity, LoginIdentity


class AuthApiTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = Client(enforce_csrf_checks=True)

    def _csrf(self) -> str:
        response = self.client.get("/api/auth/csrf/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("csrftoken", response.cookies)
        return response.cookies["csrftoken"].value

    def _create_login_user(self, *, login: str, password: str, email: str | None = None):
        return auth_service.register_user(
            login=login,
            password=password,
            password_confirm=password,
            name="Auth User",
            username=None,
            email=email,
        )

    def test_csrf_endpoint_returns_token(self):
        response = self.client.get("/api/auth/csrf/")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("csrfToken", payload)
        self.assertTrue(payload["csrfToken"])

    def test_register_success_contract(self):
        csrf = self._csrf()
        response = self.client.post(
            "/api/auth/register/",
            data=json.dumps(
                {
                    "login": "newlogin",
                    "password": "pass12345",
                    "passwordConfirm": "pass12345",
                    "name": "New User",
                    "email": "new@example.com",
                }
            ),
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(response.status_code, 201)
        payload = response.json()
        self.assertTrue(payload.get("authenticated"))
        self.assertEqual(payload.get("user", {}).get("email"), "new@example.com")
        self.assertEqual(payload.get("user", {}).get("handle"), None)
        self.assertTrue(payload.get("user", {}).get("publicId"))

        self.assertTrue(LoginIdentity.objects.filter(login_normalized="newlogin").exists())
        self.assertTrue(EmailIdentity.objects.filter(email_normalized="new@example.com").exists())

    def test_register_duplicate_email_returns_conflict(self):
        self._create_login_user(login="firstlogin", password="pass12345", email="taken@example.com")
        csrf = self._csrf()
        response = self.client.post(
            "/api/auth/register/",
            data=json.dumps(
                {
                    "login": "secondlogin",
                    "password": "pass12345",
                    "passwordConfirm": "pass12345",
                    "name": "Second User",
                    "email": "taken@example.com",
                }
            ),
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(response.status_code, 409)
        payload = response.json()
        self.assertIn("errors", payload)
        self.assertIn("email", payload["errors"])

    def test_register_duplicate_login_returns_conflict(self):
        self._create_login_user(login="duplogin", password="pass12345")
        csrf = self._csrf()
        response = self.client.post(
            "/api/auth/register/",
            data=json.dumps(
                {
                    "login": "duplogin",
                    "password": "pass12345",
                    "passwordConfirm": "pass12345",
                    "name": "Second User",
                }
            ),
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(response.status_code, 409)
        payload = response.json()
        self.assertIn("errors", payload)
        self.assertIn("login", payload["errors"])

    def test_register_invalid_username_returns_validation_error(self):
        csrf = self._csrf()
        response = self.client.post(
            "/api/auth/register/",
            data=json.dumps(
                {
                    "login": "validlogin",
                    "password": "pass12345",
                    "passwordConfirm": "pass12345",
                    "name": "Valid User",
                    "username": "invalid name",
                }
            ),
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertEqual(payload.get("code"), "invalid_username")
        self.assertIn("username", payload.get("errors", {}))

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
                    "login": "weaklogin",
                    "password": "short1",
                    "passwordConfirm": "short1",
                    "name": "Weak User",
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
            data=json.dumps({"identifier": "ghostlogin", "password": "wrong"}),
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertIn("errors", payload)
        self.assertIn("credentials", payload["errors"])

    def test_login_success_and_session(self):
        self._create_login_user(login="loginuser", password="pass12345", email="login@example.com")
        csrf = self._csrf()
        login_response = self.client.post(
            "/api/auth/login/",
            data=json.dumps({"identifier": "loginuser", "password": "pass12345"}),
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

    def test_login_success_for_django_superuser_without_identity_rows(self):
        from django.contrib.auth import get_user_model

        User = get_user_model()
        User.objects.create_superuser(
            username="admin",
            email="admin@example.com",
            password="adminpass123",
        )

        csrf = self._csrf()
        login_response = self.client.post(
            "/api/auth/login/",
            data=json.dumps({"identifier": "admin", "password": "adminpass123"}),
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(login_response.status_code, 200)
        self.assertTrue(login_response.json().get("authenticated"))

    @override_settings(AUTH_RATE_LIMIT=1, AUTH_RATE_WINDOW=60)
    def test_login_rate_limit(self):
        csrf = self._csrf()
        first = self.client.post(
            "/api/auth/login/",
            data=json.dumps({"identifier": "ghostlogin", "password": "wrong"}),
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(first.status_code, 400)

        csrf = self._csrf()
        second = self.client.post(
            "/api/auth/login/",
            data=json.dumps({"identifier": "ghostlogin", "password": "wrong"}),
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(second.status_code, 429)

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
                data=json.dumps({"identifier": "ghostlogin", "password": "wrong"}),
                content_type="application/json",
                HTTP_X_CSRFTOKEN=csrf,
            )
        self.assertEqual(response.status_code, 400)
        self.assertTrue(any("auth.login.failed" in line for line in captured.output))

    def test_google_oauth_success(self):
        user = self._create_login_user(login="googlelogin", password="pass12345")
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
        auth_mock.assert_called_once_with(
            id_token="token-value",
            access_token=None,
            username=None,
        )

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

    def test_google_oauth_accepts_access_token(self):
        user = self._create_login_user(login="googleaccess", password="pass12345")
        csrf = self._csrf()
        with patch(
            "users.api.auth_service.authenticate_or_signup_with_google",
            return_value=user,
        ) as auth_mock:
            response = self.client.post(
                "/api/auth/oauth/google/",
                data=json.dumps({"accessToken": "access-token-value"}),
                content_type="application/json",
                HTTP_X_CSRFTOKEN=csrf,
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload.get("authenticated"))
        auth_mock.assert_called_once_with(
            id_token=None,
            access_token="access-token-value",
            username=None,
        )

