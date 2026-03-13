from types import SimpleNamespace
from typing import cast
from unittest.mock import patch

from django.http import Http404
from django.test import SimpleTestCase

from roles.application import permission_service
from roles.permissions import Perm
from rooms.models import Room


class _RolesManager:
    def __init__(self, roles):
        self._roles = list(roles)

    def all(self):
        return list(self._roles)

    def order_by(self, *_args, **_kwargs):
        return self

    def first(self):
        return self._roles[0] if self._roles else None


def _room_stub(**kwargs) -> Room:
    return cast(Room, SimpleNamespace(**kwargs))


class PermissionServiceHelpersTests(SimpleTestCase):
    def test_role_and_membership_id_helpers(self):
        self.assertIsNone(permission_service._role_pk(SimpleNamespace(pk=None)))
        self.assertEqual(permission_service._role_pk(SimpleNamespace(pk="12")), 12)

        self.assertEqual(permission_service._membership_user_id(SimpleNamespace(user_id=9)), 9)
        self.assertEqual(
            permission_service._membership_user_id(
                SimpleNamespace(user_id=None, user=SimpleNamespace(pk="11"))
            ),
            11,
        )
        self.assertIsNone(
            permission_service._membership_user_id(
                SimpleNamespace(user_id=None, user=SimpleNamespace(pk=None))
            )
        )

    def test_override_target_helpers(self):
        self.assertEqual(
            permission_service._override_target_role_id(SimpleNamespace(target_role_id=5)),
            5,
        )
        self.assertEqual(
            permission_service._override_target_role_id(
                SimpleNamespace(target_role_id=None, target_role=SimpleNamespace(pk=7))
            ),
            7,
        )
        self.assertEqual(
            permission_service._override_target_user_id(SimpleNamespace(target_user_id=8)),
            8,
        )
        self.assertEqual(
            permission_service._override_target_user_id(
                SimpleNamespace(target_user_id=None, target_user=SimpleNamespace(pk=10))
            ),
            10,
        )
        self.assertIsNone(
            permission_service._override_target_user_id(
                SimpleNamespace(target_user_id=None, target_user=SimpleNamespace(pk=None))
            )
        )

    def test_top_role_position_helper(self):
        self.assertEqual(permission_service._top_role_position_for_membership(None), 0)
        membership_without_roles = SimpleNamespace(roles=_RolesManager([]))
        self.assertEqual(permission_service._top_role_position_for_membership(membership_without_roles), 0)
        membership_with_roles = SimpleNamespace(roles=_RolesManager([SimpleNamespace(position=55)]))
        self.assertEqual(permission_service._top_role_position_for_membership(membership_with_roles), 55)

    def test_default_everyone_permissions_fallbacks(self):
        public_group = _room_stub(kind=Room.Kind.GROUP, is_public=True)
        private_group = _room_stub(kind=Room.Kind.GROUP, is_public=False)
        public_room = _room_stub(kind=Room.Kind.PUBLIC, is_public=False)
        private_room = _room_stub(kind=Room.Kind.PRIVATE, is_public=False)
        self.assertEqual(
            permission_service._get_default_everyone_permissions(public_group),
            int(permission_service.EVERYONE_GROUP_PUBLIC),
        )
        self.assertEqual(
            permission_service._get_default_everyone_permissions(private_group),
            int(permission_service.EVERYONE_GROUP_PRIVATE),
        )
        self.assertEqual(
            permission_service._get_default_everyone_permissions(public_room),
            int(permission_service.EVERYONE_PUBLIC),
        )
        self.assertEqual(permission_service._get_default_everyone_permissions(private_room), 0)


class PermissionServiceBehaviorTests(SimpleTestCase):
    def test_compute_permissions_returns_zero_for_membership_when_user_pk_missing(self):
        room = _room_stub(kind=Room.Kind.PRIVATE, is_public=False)
        user = SimpleNamespace(is_authenticated=True, pk=None)
        membership = SimpleNamespace(is_banned=False, is_muted=False, roles=_RolesManager([]))
        with patch(
            "roles.application.permission_service.repositories.get_default_role_permissions",
            return_value=0,
        ), patch(
            "roles.application.permission_service.repositories.get_membership",
            return_value=membership,
        ), patch(
            "roles.application.permission_service.repositories.list_overrides",
            return_value=[],
        ):
            effective = permission_service.compute_permissions(room, user)
        self.assertEqual(effective, Perm(0))

    def test_compute_permissions_applies_matching_role_and_user_overrides(self):
        room = _room_stub(kind=Room.Kind.PRIVATE, is_public=False)
        user = SimpleNamespace(is_authenticated=True, pk=42)
        role = SimpleNamespace(pk=7, permissions=int(Perm.SEND_MESSAGES))
        membership = SimpleNamespace(is_banned=False, is_muted=False, roles=_RolesManager([role]))
        override = SimpleNamespace(
            target_role_id=7,
            target_user_id=42,
            allow=int(Perm.READ_MESSAGES),
            deny=0,
        )
        with patch(
            "roles.application.permission_service.repositories.get_default_role_permissions",
            return_value=int(Perm(0)),
        ), patch(
            "roles.application.permission_service.repositories.get_membership",
            return_value=membership,
        ), patch(
            "roles.application.permission_service.repositories.list_overrides",
            return_value=[override],
        ):
            effective = permission_service.compute_permissions(room, user)
        self.assertTrue(effective & Perm.READ_MESSAGES)

    def test_get_user_role_variants_and_actor_context(self):
        room = _room_stub(kind=Room.Kind.PRIVATE)
        user = SimpleNamespace(is_authenticated=True)
        anonymous = SimpleNamespace(is_authenticated=False)
        membership = SimpleNamespace(is_banned=False, roles=_RolesManager([SimpleNamespace(name="Admin", position=60)]))
        membership_no_roles = SimpleNamespace(is_banned=False, roles=_RolesManager([]))

        self.assertIsNone(permission_service.get_user_role(room, anonymous))
        with patch(
            "roles.application.permission_service.repositories.get_membership",
            return_value=membership,
        ):
            self.assertEqual(permission_service.get_user_role(room, user), "Admin")
        with patch(
            "roles.application.permission_service.repositories.get_membership",
            return_value=membership_no_roles,
        ):
            self.assertIsNone(permission_service.get_user_role(room, user))
        with patch(
            "roles.application.permission_service.repositories.get_membership",
            return_value=SimpleNamespace(is_banned=True, roles=_RolesManager([SimpleNamespace(name="Admin")])),
        ):
            self.assertIsNone(permission_service.get_user_role(room, user))

        with patch(
            "roles.application.permission_service.repositories.get_membership",
            return_value=membership,
        ), patch(
            "roles.application.permission_service.compute_permissions",
            return_value=Perm.MANAGE_ROLES,
        ):
            ctx = permission_service.get_actor_context(room, user)
            self.assertEqual(int(ctx.permissions), int(Perm.MANAGE_ROLES))
            self.assertEqual(ctx.top_position, 60)
            self.assertTrue(permission_service.can_manage_roles(room, user))

    def test_read_write_helpers(self):
        room = _room_stub(kind=Room.Kind.PRIVATE)
        user = SimpleNamespace()
        with patch(
            "roles.application.permission_service.compute_permissions",
            return_value=Perm.READ_MESSAGES,
        ):
            self.assertTrue(permission_service.can_read(room, user))
            self.assertFalse(permission_service.can_write(room, user))
            permission_service.ensure_can_read_or_404(room, user)
            self.assertFalse(permission_service.ensure_can_write(room, user))

        with patch(
            "roles.application.permission_service.compute_permissions",
            return_value=Perm(0),
        ):
            with self.assertRaises(Http404):
                permission_service.ensure_can_read_or_404(room, user)
