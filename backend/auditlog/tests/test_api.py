from django.contrib.auth import get_user_model
from django.test import TestCase

from auditlog.models import AuditEvent

User = get_user_model()


class AuditApiTests(TestCase):
    def setUp(self):
        self.staff = User.objects.create_user(username="audit_staff", password="pass12345", is_staff=True)
        self.member = User.objects.create_user(username="audit_member", password="pass12345")
        self.actor_one = User.objects.create_user(username="actor_one", password="pass12345")
        self.actor_two = User.objects.create_user(username="actor_two", password="pass12345")

    def test_events_endpoint_requires_staff(self):
        self.client.force_login(self.member)
        response = self.client.get("/api/admin/audit/events/")
        self.assertEqual(response.status_code, 403)

    def test_events_filters_by_user_and_action_prefix(self):
        AuditEvent.objects.create(
            action="auth.login.success",
            protocol="http",
            actor_user=self.actor_one,
            actor_user_id_snapshot=self.actor_one.pk,
            actor_username_snapshot=self.actor_one.username,
            is_authenticated=True,
            method="POST",
            path="/api/auth/login/",
            status_code=200,
            success=True,
            metadata={"room_slug": "public"},
        )
        AuditEvent.objects.create(
            action="auth.logout",
            protocol="http",
            actor_user=self.actor_two,
            actor_user_id_snapshot=self.actor_two.pk,
            actor_username_snapshot=self.actor_two.username,
            is_authenticated=True,
            method="POST",
            path="/api/auth/logout/",
            status_code=200,
            success=True,
            metadata={"room_slug": "private123"},
        )

        self.client.force_login(self.staff)
        response = self.client.get(
            "/api/admin/audit/events/",
            {"actor_user_id": self.actor_one.pk, "action_prefix": "auth.login"},
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(len(payload["items"]), 1)
        self.assertEqual(payload["items"][0]["action"], "auth.login.success")
        self.assertEqual(payload["items"][0]["actor"]["userId"], self.actor_one.pk)

    def test_actions_endpoint_returns_counts(self):
        AuditEvent.objects.create(
            action="auth.login.success",
            actor_user_id_snapshot=self.actor_one.pk,
            actor_username_snapshot=self.actor_one.username,
            is_authenticated=True,
            success=True,
        )
        AuditEvent.objects.create(
            action="auth.login.success",
            actor_user_id_snapshot=self.actor_one.pk,
            actor_username_snapshot=self.actor_one.username,
            is_authenticated=True,
            success=True,
        )
        AuditEvent.objects.create(
            action="auth.logout",
            actor_user_id_snapshot=self.actor_one.pk,
            actor_username_snapshot=self.actor_one.username,
            is_authenticated=True,
            success=True,
        )

        self.client.force_login(self.staff)
        response = self.client.get("/api/admin/audit/actions/", {"actor_user_id": self.actor_one.pk})
        self.assertEqual(response.status_code, 200)
        payload = response.json()["items"]
        by_action = {item["action"]: item["count"] for item in payload}
        self.assertEqual(by_action.get("auth.login.success"), 2)
        self.assertEqual(by_action.get("auth.logout"), 1)

    def test_username_history_endpoint(self):
        AuditEvent.objects.create(
            action="user.username.changed",
            protocol="system",
            actor_user=self.actor_one,
            actor_user_id_snapshot=self.actor_one.pk,
            actor_username_snapshot="new_name",
            is_authenticated=True,
            success=True,
            metadata={"old_username": "old_name", "new_username": "new_name"},
        )

        self.client.force_login(self.staff)
        response = self.client.get(f"/api/admin/audit/users/{self.actor_one.pk}/username-history/")
        self.assertEqual(response.status_code, 200)
        items = response.json()["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["oldUsername"], "old_name")
        self.assertEqual(items[0]["newUsername"], "new_name")

    def test_events_endpoint_returns_400_for_invalid_filters(self):
        self.client.force_login(self.staff)
        response = self.client.get("/api/admin/audit/events/", {"limit": "0"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("error", response.json())

    def test_event_detail_returns_404_when_missing(self):
        self.client.force_login(self.staff)
        response = self.client.get("/api/admin/audit/events/999999/")
        self.assertEqual(response.status_code, 404)
        self.assertIn("error", response.json())

    def test_event_detail_returns_item_when_present(self):
        event = AuditEvent.objects.create(
            action="auth.login.success",
            actor_user_id_snapshot=self.actor_one.pk,
            actor_username_snapshot=self.actor_one.username,
            is_authenticated=True,
            success=True,
        )
        self.client.force_login(self.staff)
        response = self.client.get(f"/api/admin/audit/events/{event.pk}/")
        self.assertEqual(response.status_code, 200)
        payload = response.json()["item"]
        self.assertEqual(payload["id"], event.pk)
        self.assertEqual(payload["action"], "auth.login.success")

    def test_actions_endpoint_returns_400_for_invalid_filters(self):
        self.client.force_login(self.staff)
        response = self.client.get("/api/admin/audit/actions/", {"success": "maybe"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("error", response.json())

    def test_username_history_rejects_invalid_limit(self):
        self.client.force_login(self.staff)
        bad_type = self.client.get(
            f"/api/admin/audit/users/{self.actor_one.pk}/username-history/",
            {"limit": "abc"},
        )
        self.assertEqual(bad_type.status_code, 400)
        self.assertIn("error", bad_type.json())

        bad_range = self.client.get(
            f"/api/admin/audit/users/{self.actor_one.pk}/username-history/",
            {"limit": "0"},
        )
        self.assertEqual(bad_range.status_code, 400)
        self.assertIn("error", bad_range.json())

