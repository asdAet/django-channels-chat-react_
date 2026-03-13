"""Tests for DRF permission wrappers in roles interfaces."""

from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from roles.interfaces.permissions import CanManageRoomRoles


class CanManageRoomRolesTests(SimpleTestCase):
    def setUp(self):
        self.permission = CanManageRoomRoles()

    def test_denies_when_room_slug_missing_or_invalid(self):
        request = SimpleNamespace(user=SimpleNamespace(is_authenticated=True))

        view_without_kwargs = SimpleNamespace(kwargs={})
        self.assertFalse(self.permission.has_permission(request, view_without_kwargs))

        view_with_empty_slug = SimpleNamespace(kwargs={"room_slug": ""})
        self.assertFalse(self.permission.has_permission(request, view_with_empty_slug))

    def test_denies_when_user_not_authenticated(self):
        request = SimpleNamespace(user=SimpleNamespace(is_authenticated=False))
        view = SimpleNamespace(kwargs={"room_slug": "room-1"})
        self.assertFalse(self.permission.has_permission(request, view))

    @patch("roles.interfaces.permissions.management_service.actor_can_manage_roles", return_value=True)
    def test_allows_when_service_grants_access(self, actor_can_manage_roles_mock):
        request = SimpleNamespace(user=SimpleNamespace(is_authenticated=True, pk=1))
        view = SimpleNamespace(kwargs={"room_slug": "room-1"})
        self.assertTrue(self.permission.has_permission(request, view))
        actor_can_manage_roles_mock.assert_called_once_with("room-1", request.user)

    @patch("roles.interfaces.permissions.management_service.actor_can_manage_roles", return_value=False)
    def test_denies_when_service_denies_access(self, actor_can_manage_roles_mock):
        request = SimpleNamespace(user=SimpleNamespace(is_authenticated=True, pk=1))
        view = SimpleNamespace(kwargs={"room_slug": "room-1"})
        self.assertFalse(self.permission.has_permission(request, view))
        actor_can_manage_roles_mock.assert_called_once_with("room-1", request.user)
