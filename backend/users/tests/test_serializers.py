"""Coverage tests for users serializers."""

from typing import Any, cast

from django.test import SimpleTestCase

from users.serializers import (
    LoginSerializer,
    OAuthGoogleSerializer,
    ProfileUpdateSerializer,
    RegisterSerializer,
    UserSerializer,
)


class UsersSerializersTests(SimpleTestCase):
    def test_user_serializer_accepts_full_payload(self):
        serializer = UserSerializer(
            data={
                "id": 1,
                "name": "User",
                "username": "user",
                "email": "user@example.com",
                "profileImage": None,
                "avatarCrop": None,
                "bio": "",
                "lastSeen": None,
                "registeredAt": None,
            }
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)

    def test_login_serializer_validates_email(self):
        serializer = LoginSerializer(data={"email": "bad-email", "password": "x"})
        self.assertFalse(serializer.is_valid())
        self.assertIn("email", serializer.errors)

    def test_register_serializer_requires_all_fields(self):
        serializer = RegisterSerializer(data={"email": "user@example.com"})
        self.assertFalse(serializer.is_valid())
        self.assertIn("password1", serializer.errors)
        self.assertIn("password2", serializer.errors)

    def test_oauth_google_serializer_requires_any_token(self):
        serializer = OAuthGoogleSerializer(data={"idToken": " ", "accessToken": " "})
        self.assertFalse(serializer.is_valid())
        self.assertIn("accessToken", serializer.errors)

    def test_oauth_google_serializer_normalizes_values(self):
        serializer = OAuthGoogleSerializer(data={"idToken": "  id  ", "accessToken": "  "})
        self.assertTrue(serializer.is_valid(), serializer.errors)
        validated_data = cast(dict[str, Any], serializer.validated_data)
        self.assertEqual(validated_data.get("idToken"), "id")
        self.assertEqual(validated_data.get("accessToken"), "")

    def test_profile_update_serializer_accepts_crop_fields(self):
        serializer = ProfileUpdateSerializer(
            data={
                "name": "Test",
                "username": "tester",
                "bio": "bio",
                "avatarCropX": 0.1,
                "avatarCropY": 0.2,
                "avatarCropWidth": 0.3,
                "avatarCropHeight": 0.4,
            }
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
