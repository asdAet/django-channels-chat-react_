from django.test import SimpleTestCase

from roles.domain import rules
from roles.permissions import Perm


class RoleDomainRulesTests(SimpleTestCase):
    def test_parse_direct_pair_key_valid_and_invalid(self):
        self.assertEqual(rules.parse_direct_pair_key("1:2"), (1, 2))
        self.assertIsNone(rules.parse_direct_pair_key(None))
        self.assertIsNone(rules.parse_direct_pair_key("12"))
        self.assertIsNone(rules.parse_direct_pair_key("x:2"))

    def test_direct_access_allowed_invariant(self):
        self.assertTrue(
            rules.direct_access_allowed(
                user_id=1,
                pair=(1, 2),
                membership_user_ids={1, 2},
                banned_user_ids=set(),
            )
        )
        self.assertFalse(
            rules.direct_access_allowed(
                user_id=None,
                pair=(1, 2),
                membership_user_ids={1, 2},
                banned_user_ids=set(),
            )
        )
        self.assertFalse(
            rules.direct_access_allowed(
                user_id=3,
                pair=(1, 2),
                membership_user_ids={1, 2},
                banned_user_ids=set(),
            )
        )
        self.assertFalse(
            rules.direct_access_allowed(
                user_id=1,
                pair=(1, 2),
                membership_user_ids={2},
                banned_user_ids=set(),
            )
        )
        self.assertFalse(
            rules.direct_access_allowed(
                user_id=1,
                pair=(1, 2),
                membership_user_ids={1, 2},
                banned_user_ids={1},
            )
        )

    def test_resolve_permissions_applies_overrides(self):
        effective = rules.resolve_permissions(
            everyone_permissions=int(Perm.READ_MESSAGES | Perm.SEND_MESSAGES),
            role_permissions=[int(Perm.ATTACH_FILES)],
            role_overrides=[
                (int(Perm.MANAGE_MESSAGES), int(Perm.SEND_MESSAGES)),
            ],
            user_overrides=[
                (int(Perm.SEND_MESSAGES), int(Perm.ATTACH_FILES)),
            ],
        )
        self.assertTrue(effective & Perm.READ_MESSAGES)
        self.assertTrue(effective & Perm.SEND_MESSAGES)
        self.assertTrue(effective & Perm.MANAGE_MESSAGES)
        self.assertFalse(effective & Perm.ATTACH_FILES)

    def test_resolve_permissions_returns_all_for_admin(self):
        by_base = rules.resolve_permissions(
            everyone_permissions=int(Perm.ADMINISTRATOR),
            role_permissions=[],
            role_overrides=[],
            user_overrides=[],
        )
        by_override = rules.resolve_permissions(
            everyone_permissions=int(Perm.READ_MESSAGES),
            role_permissions=[],
            role_overrides=[],
            user_overrides=[(int(Perm.ADMINISTRATOR), 0)],
        )
        self.assertEqual(by_base, Perm(-1))
        self.assertEqual(by_override, Perm(-1))

    def test_permission_and_hierarchy_helpers(self):
        self.assertTrue(
            rules.is_permission_subset(
                candidate=int(Perm.SEND_MESSAGES),
                holder=int(Perm.ADMINISTRATOR),
            )
        )
        self.assertTrue(
            rules.is_permission_subset(
                candidate=int(Perm.READ_MESSAGES),
                holder=int(Perm.READ_MESSAGES | Perm.SEND_MESSAGES),
            )
        )
        self.assertFalse(
            rules.is_permission_subset(
                candidate=int(Perm.MANAGE_ROLES),
                holder=int(Perm.READ_MESSAGES),
            )
        )

        self.assertTrue(rules.can_manage_target(actor_top_position=10, target_position=5))
        self.assertFalse(rules.can_manage_target(actor_top_position=5, target_position=5))

    def test_normalize_role_ids_target_validation_and_protected_checks(self):
        normalized = rules.normalize_role_ids([1, "2", "x", 2, 0, -1, 3, 3])
        self.assertEqual(normalized, [1, 2, 3])

        self.assertTrue(rules.validate_override_target_ids(1, None))
        self.assertTrue(rules.validate_override_target_ids(None, 2))
        self.assertFalse(rules.validate_override_target_ids(None, None))
        self.assertFalse(rules.validate_override_target_ids(1, 2))

        self.assertTrue(rules.has_manage_roles(int(Perm.MANAGE_ROLES)))
        self.assertFalse(rules.has_manage_roles(int(Perm.READ_MESSAGES)))

        self.assertTrue(rules.role_is_protected(is_default=True, name="Any"))
        self.assertTrue(rules.role_is_protected(is_default=False, name="Owner"))
        self.assertFalse(rules.role_is_protected(is_default=False, name="Moderator"))
