from types import SimpleNamespace
from typing import cast
from unittest.mock import patch

from django.test import SimpleTestCase, override_settings

from groups.domain import rules
from rooms.models import Room


class GroupDomainRulesTests(SimpleTestCase):
    @override_settings(GROUP_INVITE_CODE_LENGTH=6)
    def test_generate_invite_code_uses_configured_length(self):
        code = rules.generate_invite_code()
        self.assertEqual(len(code), 6)
        self.assertTrue(code.isalnum())

    def test_validate_group_name(self):
        self.assertEqual(rules.validate_group_name("  Team  "), "Team")
        with self.assertRaises(ValueError):
            rules.validate_group_name("   ")
        with self.assertRaises(ValueError):
            rules.validate_group_name("x" * 51)

    def test_validate_group_username(self):
        self.assertIsNone(rules.validate_group_username(None))
        self.assertIsNone(rules.validate_group_username(""))
        self.assertEqual(rules.validate_group_username("  My_Group9 "), "my_group9")
        with self.assertRaises(ValueError):
            rules.validate_group_username("1bad")

    def test_validate_description_and_slow_mode(self):
        self.assertEqual(rules.validate_group_description("ok"), "ok")
        with self.assertRaises(ValueError):
            rules.validate_group_description("x" * 2001)

        self.assertEqual(rules.validate_slow_mode(0), 0)
        self.assertEqual(rules.validate_slow_mode(3600), 3600)
        with self.assertRaises(ValueError):
            rules.validate_slow_mode(-1)
        with self.assertRaises(ValueError):
            rules.validate_slow_mode(86401)

    def test_ensure_is_group(self):
        group_room = cast(Room, SimpleNamespace(kind=Room.Kind.GROUP))
        rules.ensure_is_group(group_room)

        private_room = cast(Room, SimpleNamespace(kind=Room.Kind.PRIVATE))
        with self.assertRaises(ValueError):
            rules.ensure_is_group(private_room)

    def test_generate_group_slug_handles_short_and_long_names(self):
        with patch("groups.domain.rules.secrets.token_hex", side_effect=["abcd1234", "deadbeef"]):
            short_slug = rules.generate_group_slug("!!")
        self.assertTrue(short_slug.startswith("g--abcd1234-"))
        self.assertTrue(short_slug.endswith("-deadbeef"))

        with patch("groups.domain.rules.secrets.token_hex", return_value="cafebabe"):
            long_slug = rules.generate_group_slug("Very Long Group Name !!! With ### Symbols")
        self.assertTrue(long_slug.startswith("g-very-long-group-name-with-symbols"))
        self.assertTrue(long_slug.endswith("-cafebabe"))
