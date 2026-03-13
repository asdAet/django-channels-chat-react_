"""Coverage tests for users.identity helpers."""

from __future__ import annotations

from unittest.mock import patch
from unittest.mock import Mock

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from users import identity
from users.models import Profile

User = get_user_model()


class UsersIdentityTests(TestCase):
    def test_normalizers_handle_non_string_and_prefix(self):
        self.assertEqual(identity.normalize_email(None), "")
        self.assertEqual(identity.normalize_email("  A@B.C "), "a@b.c")
        self.assertEqual(identity.normalize_public_username(None), "")
        self.assertEqual(identity.normalize_public_username("  @Alice  "), "Alice")

    @override_settings(USERNAME_MAX_LENGTH=5)
    def test_validate_public_username_enforces_rules(self):
        with self.assertRaises(ValueError):
            identity.validate_public_username("")
        with self.assertRaises(ValueError):
            identity.validate_public_username("abcdef")
        with self.assertRaises(ValueError):
            identity.validate_public_username("bad name")
        self.assertEqual(identity.validate_public_username("@Alice"), "Alice")

    def test_generate_technical_username_retries_on_collision(self):
        User.objects.create_user(username="seed_aaaaaa", password="pass12345")
        with patch("users.identity.secrets.token_hex", side_effect=["aaaaaa", "bbbbbb"]):
            generated = identity.generate_technical_username("seed")
        self.assertEqual(generated, "seed_bbbbbb")

    def test_generate_technical_username_uses_last_resort_fallback(self):
        filter_result = Mock()
        filter_result.exists.side_effect = [True] * 16 + [False]
        token_values = ["aaaaaa"] * 16 + ["deadbeefdeadbeef"]
        with patch("users.identity.User.objects.filter", return_value=filter_result), patch(
            "users.identity.secrets.token_hex",
            side_effect=token_values,
        ):
            generated = identity.generate_technical_username("seed")
        self.assertEqual(generated, "u_deadbeefdeadbeef")

    def test_user_public_username_and_display_name_priority(self):
        user = User.objects.create_user(username="fallback_user", password="pass12345", first_name="First")
        profile = identity.ensure_profile(user)
        profile.username = "publicname"
        profile.name = "Display Name"
        profile.save(update_fields=["username", "name"])

        self.assertEqual(identity.user_public_username(user), "publicname")
        self.assertEqual(identity.user_display_name(user), "Display Name")

        profile.name = ""
        profile.username = None
        profile.save(update_fields=["name", "username"])
        self.assertEqual(identity.user_public_username(user), "fallback_user")
        self.assertEqual(identity.user_display_name(user), "First")

    def test_get_user_by_public_username_supports_profile_and_legacy_fallback(self):
        by_profile = User.objects.create_user(username="legacy_a", password="pass12345")
        by_profile_profile = identity.ensure_profile(by_profile)
        by_profile_profile.username = "profile_handle"
        by_profile_profile.save(update_fields=["username"])

        by_legacy = User.objects.create_user(username="legacy_handle", password="pass12345")
        by_legacy_profile = identity.ensure_profile(by_legacy)
        by_legacy_profile.username = None
        by_legacy_profile.save(update_fields=["username"])

        self.assertEqual(identity.get_user_by_public_username("profile_handle"), by_profile)
        self.assertEqual(identity.get_user_by_public_username("legacy_handle"), by_legacy)
        self.assertIsNone(identity.get_user_by_public_username(""))

    def test_ensure_profile_returns_existing_or_creates_new(self):
        user = User.objects.create_user(username="profile_user", password="pass12345")
        existing = identity.ensure_profile(user)
        existing_user = getattr(existing, "user", None)
        self.assertEqual(getattr(existing_user, "pk", None), user.pk)

        Profile.objects.filter(user=user).delete()
        user.refresh_from_db()
        recreated = identity.ensure_profile(user)
        recreated_user = getattr(recreated, "user", None)
        self.assertEqual(getattr(recreated_user, "pk", None), user.pk)
