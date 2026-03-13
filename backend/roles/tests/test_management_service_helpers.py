from contextlib import nullcontext
from types import SimpleNamespace
from typing import cast
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from roles.application import management_service
from roles.application.errors import RoleConflictError, RoleForbiddenError, RoleNotFoundError, RoleServiceError
from roles.application.permission_service import ActorContext
from roles.models import Membership, PermissionOverride
from roles.permissions import Perm
from rooms.models import Room


class _RolesManager:
    def __init__(self, roles):
        self._roles = list(roles)

    def order_by(self, *_args, **_kwargs):
        return self

    def first(self):
        return self._roles[0] if self._roles else None


def _room_stub(**kwargs) -> Room:
    return cast(Room, SimpleNamespace(**kwargs))


def _membership_stub(**kwargs) -> Membership:
    return cast(Membership, SimpleNamespace(**kwargs))


def _override_stub(**kwargs) -> PermissionOverride:
    return cast(PermissionOverride, SimpleNamespace(**kwargs))


class ManagementServiceHelperTests(SimpleTestCase):
    def test_load_room_and_authentication_guards(self):
        room = _room_stub(slug="r1")
        with patch("roles.application.management_service.repositories.get_room_by_slug", return_value=room):
            self.assertEqual(management_service._load_room_or_raise("r1"), room)
        with patch("roles.application.management_service.repositories.get_room_by_slug", return_value=None):
            with self.assertRaises(RoleNotFoundError):
                management_service._load_room_or_raise("missing")

        with self.assertRaises(RoleForbiddenError):
            management_service._ensure_authenticated(None)
        with self.assertRaises(RoleForbiddenError):
            management_service._ensure_authenticated(SimpleNamespace(is_authenticated=False))
        management_service._ensure_authenticated(SimpleNamespace(is_authenticated=True))

    def test_permissions_subset_and_membership_position_helpers(self):
        actor_ctx = ActorContext(permissions=Perm.READ_MESSAGES, top_position=10)
        with self.assertRaises(RoleForbiddenError):
            management_service._ensure_permissions_subset(
                actor_ctx,
                candidate_permissions=int(Perm.MANAGE_ROLES),
            )

        self.assertEqual(management_service._membership_top_position(None), 0)
        self.assertEqual(
            management_service._membership_top_position(_membership_stub(roles=_RolesManager([]))),
            0,
        )
        self.assertEqual(
            management_service._membership_top_position(
                _membership_stub(roles=_RolesManager([SimpleNamespace(position=42)]))
            ),
            42,
        )

    def test_object_and_membership_identity_helpers(self):
        self.assertEqual(management_service._obj_pk(SimpleNamespace(pk="4"), field_name="role"), 4)
        with self.assertRaises(RoleServiceError):
            management_service._obj_pk(SimpleNamespace(pk=None), field_name="role")

        self.assertEqual(management_service._membership_user_id(_membership_stub(user_id=7)), 7)
        self.assertEqual(
            management_service._membership_user_id(
                _membership_stub(user_id=None, user=SimpleNamespace(pk="9"))
            ),
            9,
        )
        with self.assertRaises(RoleServiceError):
            management_service._membership_user_id(
                _membership_stub(user_id=None, user=SimpleNamespace(pk=None))
            )

    def test_override_target_helpers_and_manage_roles_predicate(self):
        self.assertEqual(
            management_service._override_target_role_id(_override_stub(target_role_id=5)),
            5,
        )
        self.assertEqual(
            management_service._override_target_role_id(
                _override_stub(target_role_id=None, target_role=SimpleNamespace(pk=11))
            ),
            11,
        )
        self.assertIsNone(
            management_service._override_target_role_id(
                _override_stub(target_role_id=None, target_role=SimpleNamespace(pk=None))
            )
        )

        self.assertEqual(
            management_service._override_target_user_id(_override_stub(target_user_id=6)),
            6,
        )
        self.assertEqual(
            management_service._override_target_user_id(
                _override_stub(target_user_id=None, target_user=SimpleNamespace(pk=12))
            ),
            12,
        )
        self.assertIsNone(
            management_service._override_target_user_id(
                _override_stub(target_user_id=None, target_user=SimpleNamespace(pk=None))
            )
        )

        direct_room = _room_stub(kind=Room.Kind.DIRECT)
        private_room = _room_stub(kind=Room.Kind.PRIVATE)
        with patch("roles.application.management_service.repositories.get_room_by_slug", return_value=None):
            self.assertFalse(management_service.actor_can_manage_roles("missing", SimpleNamespace()))
        with patch("roles.application.management_service.repositories.get_room_by_slug", return_value=direct_room):
            self.assertFalse(management_service.actor_can_manage_roles("dm", SimpleNamespace()))
        with patch("roles.application.management_service.repositories.get_room_by_slug", return_value=private_room), patch(
            "roles.application.management_service.can_manage_roles",
            return_value=True,
        ):
            self.assertTrue(management_service.actor_can_manage_roles("room", SimpleNamespace()))

    def test_list_room_roles_and_member_not_found_paths(self):
        context = management_service.RoomActorContext(
            room=_room_stub(slug="room"),
            actor_context=ActorContext(permissions=Perm.ADMINISTRATOR, top_position=99),
        )
        with patch(
            "roles.application.management_service._room_actor_context_or_raise",
            return_value=context,
        ), patch(
            "roles.application.management_service.repositories.list_roles",
            return_value=[1, 2],
        ):
            self.assertEqual(management_service.list_room_roles("room", SimpleNamespace()), [1, 2])

        with patch(
            "roles.application.management_service._room_actor_context_or_raise",
            return_value=context,
        ), patch(
            "roles.application.management_service.repositories.get_membership_by_user_id",
            return_value=None,
        ):
            with self.assertRaises(RoleNotFoundError):
                management_service.get_member_roles("room", 1, SimpleNamespace())
            with self.assertRaises(RoleNotFoundError):
                management_service.set_member_roles("room", 1, SimpleNamespace(), [1, 2])

    def test_update_room_role_error_and_change_paths(self):
        actor = SimpleNamespace(pk=1, username="actor", is_authenticated=True)
        context = management_service.RoomActorContext(
            room=_room_stub(slug="room"),
            actor_context=ActorContext(permissions=Perm.ADMINISTRATOR, top_position=99),
        )

        with patch(
            "roles.application.management_service._room_actor_context_or_raise",
            return_value=context,
        ), patch(
            "roles.application.management_service.repositories.get_role",
            return_value=None,
        ):
            with self.assertRaises(RoleNotFoundError):
                management_service.update_room_role("room", 5, actor, name="new")

        protected = SimpleNamespace(position=1, is_default=True, name="@everyone")
        with patch(
            "roles.application.management_service._room_actor_context_or_raise",
            return_value=context,
        ), patch(
            "roles.application.management_service.repositories.get_role",
            return_value=protected,
        ):
            with self.assertRaises(RoleForbiddenError):
                management_service.update_room_role("room", 5, actor, name="new")

        role = SimpleNamespace(
            pk=50,
            name="old",
            color="#111111",
            position=1,
            permissions=0,
            is_default=False,
            save=MagicMock(),
        )
        with patch(
            "roles.application.management_service._room_actor_context_or_raise",
            return_value=context,
        ), patch(
            "roles.application.management_service.repositories.get_role",
            return_value=role,
        ), patch(
            "roles.application.management_service.rules.role_is_protected",
            return_value=False,
        ), patch(
            "roles.application.management_service.transaction.atomic",
            return_value=nullcontext(),
        ), patch(
            "roles.application.management_service.audit_security_event",
        ):
            updated = management_service.update_room_role(
                "room",
                50,
                actor,
                name="new-name",
                position=2,
                permissions=int(Perm.READ_MESSAGES),
            )
        self.assertEqual(updated.name, "new-name")
        role.save.assert_called_once()

    def test_resolve_override_target_validation_and_lookup_errors(self):
        room = _room_stub(slug="room")
        actor_context = ActorContext(permissions=Perm.ADMINISTRATOR, top_position=99)

        with self.assertRaises(RoleServiceError):
            management_service._resolve_override_target(
                room=room,
                actor_context=actor_context,
                target_role_id=None,
                target_user_id=None,
            )

        with patch("roles.application.management_service.repositories.get_role", return_value=None):
            with self.assertRaises(RoleNotFoundError):
                management_service._resolve_override_target(
                    room=room,
                    actor_context=actor_context,
                    target_role_id=1,
                    target_user_id=None,
                )

        with patch("roles.application.management_service.repositories.get_membership_by_user_id", return_value=None):
            with self.assertRaises(RoleNotFoundError):
                management_service._resolve_override_target(
                    room=room,
                    actor_context=actor_context,
                    target_role_id=None,
                    target_user_id=2,
                )

    def test_create_room_role_conflict_when_name_exists(self):
        actor = SimpleNamespace(pk=1, username="actor", is_authenticated=True)
        context = management_service.RoomActorContext(
            room=_room_stub(slug="room"),
            actor_context=ActorContext(permissions=Perm.ADMINISTRATOR, top_position=99),
        )
        with patch(
            "roles.application.management_service._room_actor_context_or_raise",
            return_value=context,
        ), patch(
            "roles.application.management_service.transaction.atomic",
            return_value=nullcontext(),
        ), patch(
            "roles.application.management_service.Role.objects.create",
            side_effect=management_service.IntegrityError("dup"),
        ):
            with self.assertRaises(RoleConflictError):
                management_service.create_room_role(
                    "room",
                    actor,
                    name="Owner",
                    color="#111111",
                    position=1,
                    permissions=int(Perm.READ_MESSAGES),
                )

    def test_update_room_role_conflict_when_save_raises_integrity(self):
        actor = SimpleNamespace(pk=1, username="actor", is_authenticated=True)
        context = management_service.RoomActorContext(
            room=_room_stub(slug="room"),
            actor_context=ActorContext(permissions=Perm.ADMINISTRATOR, top_position=99),
        )
        role = SimpleNamespace(
            pk=50,
            name="old",
            color="#111111",
            position=1,
            permissions=0,
            is_default=False,
        )
        role.save = MagicMock(side_effect=management_service.IntegrityError("dup"))
        with patch(
            "roles.application.management_service._room_actor_context_or_raise",
            return_value=context,
        ), patch(
            "roles.application.management_service.repositories.get_role",
            return_value=role,
        ), patch(
            "roles.application.management_service.rules.role_is_protected",
            return_value=False,
        ), patch(
            "roles.application.management_service.transaction.atomic",
            return_value=nullcontext(),
        ):
            with self.assertRaises(RoleConflictError):
                management_service.update_room_role("room", 50, actor, name="new")

    def test_delete_room_role_not_found_and_protected(self):
        actor = SimpleNamespace(pk=1, username="actor", is_authenticated=True)
        context = management_service.RoomActorContext(
            room=_room_stub(slug="room"),
            actor_context=ActorContext(permissions=Perm.ADMINISTRATOR, top_position=99),
        )
        with patch(
            "roles.application.management_service._room_actor_context_or_raise",
            return_value=context,
        ), patch(
            "roles.application.management_service.repositories.get_role",
            return_value=None,
        ):
            with self.assertRaises(RoleNotFoundError):
                management_service.delete_room_role("room", 1, actor)

        protected = SimpleNamespace(position=1, is_default=True, name="Owner")
        with patch(
            "roles.application.management_service._room_actor_context_or_raise",
            return_value=context,
        ), patch(
            "roles.application.management_service.repositories.get_role",
            return_value=protected,
        ):
            with self.assertRaises(RoleForbiddenError):
                management_service.delete_room_role("room", 1, actor)

    def test_update_room_override_error_paths_and_change_save(self):
        actor = SimpleNamespace(pk=1, username="actor", is_authenticated=True)
        context = management_service.RoomActorContext(
            room=_room_stub(slug="room"),
            actor_context=ActorContext(permissions=Perm.ADMINISTRATOR, top_position=99),
        )

        with patch(
            "roles.application.management_service._room_actor_context_or_raise",
            return_value=context,
        ), patch(
            "roles.application.management_service.repositories.get_override",
            return_value=None,
        ):
            with self.assertRaises(RoleNotFoundError):
                management_service.update_room_override("room", 10, actor, allow=1)

        role_target_override = SimpleNamespace(
            pk=10,
            allow=0,
            deny=0,
            target_role_id=5,
            target_user_id=None,
            save=MagicMock(),
        )
        with patch(
            "roles.application.management_service._room_actor_context_or_raise",
            return_value=context,
        ), patch(
            "roles.application.management_service.repositories.get_override",
            return_value=role_target_override,
        ), patch(
            "roles.application.management_service.repositories.get_role",
            return_value=None,
        ):
            with self.assertRaises(RoleNotFoundError):
                management_service.update_room_override("room", 10, actor, allow=1)

        user_target_override = SimpleNamespace(
            pk=11,
            allow=0,
            deny=0,
            target_role_id=None,
            target_user_id=8,
            save=MagicMock(),
        )
        with patch(
            "roles.application.management_service._room_actor_context_or_raise",
            return_value=context,
        ), patch(
            "roles.application.management_service.repositories.get_override",
            return_value=user_target_override,
        ), patch(
            "roles.application.management_service.repositories.get_membership_by_user_id",
            return_value=None,
        ):
            with self.assertRaises(RoleNotFoundError):
                management_service.update_room_override("room", 11, actor, allow=1)

        role_target_override.allow = 0
        role_target_override.deny = 0
        with patch(
            "roles.application.management_service._room_actor_context_or_raise",
            return_value=context,
        ), patch(
            "roles.application.management_service.repositories.get_override",
            return_value=role_target_override,
        ), patch(
            "roles.application.management_service.repositories.get_role",
            return_value=SimpleNamespace(position=1),
        ), patch(
            "roles.application.management_service.transaction.atomic",
            return_value=nullcontext(),
        ), patch(
            "roles.application.management_service.audit_security_event",
        ):
            updated = management_service.update_room_override("room", 10, actor, allow=2, deny=4)
        self.assertEqual(updated.allow, 2)
        self.assertEqual(updated.deny, 4)
        role_target_override.save.assert_called()

    def test_delete_room_override_error_and_target_branches(self):
        actor = SimpleNamespace(pk=1, username="actor", is_authenticated=True)
        context = management_service.RoomActorContext(
            room=_room_stub(slug="room"),
            actor_context=ActorContext(permissions=Perm.ADMINISTRATOR, top_position=99),
        )

        with patch(
            "roles.application.management_service._room_actor_context_or_raise",
            return_value=context,
        ), patch(
            "roles.application.management_service.repositories.get_override",
            return_value=None,
        ):
            with self.assertRaises(RoleNotFoundError):
                management_service.delete_room_override("room", 1, actor)

        role_override = SimpleNamespace(
            pk=20,
            target_role_id=5,
            target_user_id=None,
            delete=MagicMock(),
        )
        with patch(
            "roles.application.management_service._room_actor_context_or_raise",
            return_value=context,
        ), patch(
            "roles.application.management_service.repositories.get_override",
            return_value=role_override,
        ), patch(
            "roles.application.management_service.repositories.get_role",
            return_value=SimpleNamespace(position=1),
        ), patch(
            "roles.application.management_service.transaction.atomic",
            return_value=nullcontext(),
        ), patch(
            "roles.application.management_service.audit_security_event",
        ):
            management_service.delete_room_override("room", 20, actor)

        user_override = SimpleNamespace(
            pk=21,
            target_role_id=None,
            target_user_id=8,
            delete=MagicMock(),
        )
        with patch(
            "roles.application.management_service._room_actor_context_or_raise",
            return_value=context,
        ), patch(
            "roles.application.management_service.repositories.get_override",
            return_value=user_override,
        ), patch(
            "roles.application.management_service.repositories.get_membership_by_user_id",
            return_value=SimpleNamespace(roles=_RolesManager([SimpleNamespace(position=1)])),
        ), patch(
            "roles.application.management_service.transaction.atomic",
            return_value=nullcontext(),
        ), patch(
            "roles.application.management_service.audit_security_event",
        ):
            management_service.delete_room_override("room", 21, actor)
