"""Direct unit tests for users.application.auth_service."""

from __future__ import annotations

from unittest.mock import patch

import requests
from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import make_password
from django.test import TestCase, override_settings

from users.application import auth_service
from users.application.errors import (
    IdentityConflictError,
    IdentityServiceError,
    IdentityUnauthorizedError,
)
from users.models import EmailIdentity, OAuthIdentity

User = get_user_model()


class _MockResponse:
    def __init__(self, status_code: int, payload: dict):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


class AuthServiceUnitTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="svc_auth_user", email="svc@example.com")
        self.user.set_unusable_password()
        self.user.save(update_fields=["password"])
        EmailIdentity.objects.create(
            user=self.user,
            email_normalized="svc@example.com",
            password_hash=make_password("pass12345"),
        )

    def test_register_validates_required_fields_and_duplicates(self):
        with self.assertRaises(IdentityServiceError):
            auth_service.register_with_email("", "pass12345", "pass12345")
        with self.assertRaises(IdentityServiceError):
            auth_service.register_with_email("new@example.com", "", "")
        with self.assertRaises(IdentityServiceError):
            auth_service.register_with_email("new@example.com", "pass12345", "wrong")
        with self.assertRaises(IdentityConflictError):
            auth_service.register_with_email("svc@example.com", "pass12345", "pass12345")

    def test_login_with_email_success_and_failures(self):
        self.assertEqual(auth_service.login_with_email("svc@example.com", "pass12345"), self.user)
        with self.assertRaises(IdentityUnauthorizedError):
            auth_service.login_with_email("svc@example.com", "wrong")
        with self.assertRaises(IdentityUnauthorizedError):
            auth_service.login_with_email("missing@example.com", "pass12345")
        with self.assertRaises(IdentityUnauthorizedError):
            auth_service.login_with_email("", "")

    def test_internal_helpers_cover_normalization_branches(self):
        self.assertEqual(auth_service._email_local_part("x@y.z"), "x")
        self.assertEqual(auth_service._email_local_part(""), "user")
        self.assertEqual(auth_service._resolve_google_audience({"aud": "A"}), "A")
        self.assertEqual(auth_service._resolve_google_audience({"audience": "B"}), "B")
        self.assertIn("profile", auth_service._normalize_google_scopes("openid,https://www.googleapis.com/auth/userinfo.profile"))

    @override_settings(GOOGLE_OAUTH_CLIENT_ID="")
    def test_get_expected_google_audience_requires_setting(self):
        with self.assertRaises(IdentityServiceError) as exc:
            auth_service._get_expected_google_audience()
        self.assertEqual(exc.exception.status_code, 503)

    def test_verify_google_token_requires_access_or_id_token(self):
        with self.assertRaises(IdentityServiceError) as exc:
            auth_service._verify_google_token()
        self.assertIn("accessToken", exc.exception.errors)
        self.assertIn("idToken", exc.exception.errors)

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
        bad_payload = {
            "aud": "client-id",
            "iss": "https://bad.example.com",
            "exp": "9999999999",
            "email_verified": "true",
            "sub": "sub-1",
        }
        with patch(
            "users.application.auth_service.requests.get",
            return_value=_MockResponse(200, bad_payload),
        ):
            with self.assertRaises(IdentityUnauthorizedError):
                auth_service._verify_google_id_token("token")

    @override_settings(GOOGLE_OAUTH_CLIENT_ID="client-id")
    def test_verify_google_id_token_validates_audience_exp_email_and_subject(self):
        base = {
            "iss": "https://accounts.google.com",
            "aud": "client-id",
            "exp": "9999999999",
            "email_verified": "true",
            "sub": "sub-1",
        }
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

    def test_verify_google_access_token_requires_non_empty_token(self):
        with self.assertRaises(IdentityServiceError) as exc:
            auth_service._verify_google_access_token("")
        self.assertIn("accessToken", exc.exception.errors)

    @override_settings(GOOGLE_OAUTH_CLIENT_ID="client-id")
    def test_verify_google_access_token_handles_error_branches(self):
        with patch("users.application.auth_service.requests.get", side_effect=requests.RequestException):
            with self.assertRaises(IdentityServiceError):
                auth_service._verify_google_access_token("token")

        tokeninfo_ok = _MockResponse(
            200,
            {
                "audience": "client-id",
                "expires_in": "3600",
                "scope": "email",
            },
        )
        with patch("users.application.auth_service.requests.get", return_value=tokeninfo_ok):
            with self.assertRaises(IdentityUnauthorizedError):
                auth_service._verify_google_access_token("token")

    @override_settings(GOOGLE_OAUTH_CLIENT_ID="client-id")
    def test_verify_google_access_token_success_merges_payload(self):
        responses = [
            _MockResponse(
                200,
                {
                    "audience": "client-id",
                    "expires_in": "3599",
                    "scope": "email profile",
                },
            ),
            _MockResponse(
                200,
                {
                    "sub": "google-sub-123",
                    "email": "Google.User@example.com",
                    "email_verified": True,
                    "given_name": "Google",
                    "family_name": "User",
                },
            ),
        ]

        with patch("users.application.auth_service.requests.get", side_effect=responses):
            payload = auth_service._verify_google_access_token("token")
        self.assertEqual(payload["sub"], "google-sub-123")
        self.assertEqual(payload["email"], "google.user@example.com")
        self.assertEqual(payload["name"], "Google User")

    @override_settings(GOOGLE_OAUTH_CLIENT_ID="client-id")
    def test_verify_google_access_token_rejects_userinfo_edge_cases(self):
        tokeninfo = _MockResponse(
            200,
            {
                "audience": "client-id",
                "expires_in": "3600",
                "scope": "email profile",
            },
        )
        with patch(
            "users.application.auth_service.requests.get",
            side_effect=[tokeninfo, _MockResponse(200, {"sub": "", "email_verified": True, "email": "x@y.z"})],
        ):
            with self.assertRaises(IdentityUnauthorizedError):
                auth_service._verify_google_access_token("token")

        with patch(
            "users.application.auth_service.requests.get",
            side_effect=[tokeninfo, _MockResponse(200, {"sub": "sub", "email_verified": False, "email": "x@y.z"})],
        ):
            with self.assertRaises(IdentityUnauthorizedError):
                auth_service._verify_google_access_token("token")

        with patch(
            "users.application.auth_service.requests.get",
            side_effect=[tokeninfo, _MockResponse(200, {"sub": "sub", "email_verified": True, "email": ""})],
        ):
            with self.assertRaises(IdentityUnauthorizedError):
                auth_service._verify_google_access_token("token")

    def test_signup_with_google_conflict_and_login_paths(self):
        OAuthIdentity.objects.create(
            user=self.user,
            provider=OAuthIdentity.Provider.GOOGLE,
            provider_user_id="sub-existing",
            email_from_provider="svc@example.com",
        )

        with patch(
            "users.application.auth_service._verify_google_token",
            return_value={"sub": "sub-existing", "email": "svc@example.com", "name": "Svc User"},
        ):
            with self.assertRaises(IdentityConflictError):
                auth_service.signup_with_google("id-token")

        with patch(
            "users.application.auth_service._verify_google_token",
            return_value={"sub": "sub-existing", "email": "svc@example.com", "name": "Svc User"},
        ):
            self.assertEqual(auth_service.login_with_google("id-token"), self.user)
            self.assertEqual(auth_service.authenticate_or_signup_with_google("id-token"), self.user)

    def test_signup_and_authenticate_or_signup_create_new_user(self):
        payload = {"sub": "sub-new", "email": "new_oauth@example.com", "name": "New OAuth"}
        with patch("users.application.auth_service._verify_google_token", return_value=payload):
            created = auth_service.signup_with_google("id-token")
        self.assertEqual(created.email, "new_oauth@example.com")
        self.assertTrue(
            OAuthIdentity.objects.filter(
                user=created,
                provider=OAuthIdentity.Provider.GOOGLE,
                provider_user_id="sub-new",
            ).exists()
        )

        payload_two = {"sub": "sub-another", "email": "another@example.com", "name": "Another OAuth"}
        with patch("users.application.auth_service._verify_google_token", return_value=payload_two):
            created_two = auth_service.authenticate_or_signup_with_google("id-token")
        self.assertEqual(created_two.email, "another@example.com")

    def test_verify_google_token_delegates_to_id_token_branch(self):
        with patch("users.application.auth_service._verify_google_id_token", return_value={"ok": True}) as verify_mock:
            result = auth_service._verify_google_token(id_token="  id-token  ")
        self.assertEqual(result, {"ok": True})
        verify_mock.assert_called_once_with("id-token")

    def test_login_with_google_raises_when_identity_missing(self):
        with patch(
            "users.application.auth_service._verify_google_token",
            return_value={"sub": "sub-missing", "email": "missing@example.com", "name": "Missing"},
        ):
            with self.assertRaises(IdentityUnauthorizedError):
                auth_service.login_with_google("id-token")

    def test_set_username_and_profile_name_helpers(self):
        self.assertIsNone(auth_service.set_username(self.user, ""))
        username = auth_service.set_username(self.user, "validname")
        self.assertEqual(username, "validname")

        with self.assertRaises(IdentityServiceError):
            auth_service.set_username(self.user, "invalid name")

        display_name = auth_service.set_profile_name(self.user, " <b>Name</b> ")
        self.assertEqual(display_name, "Name")
        self.assertEqual(auth_service.get_user_by_username("validname"), self.user)
