"""Unit tests for audit query parsing/building helpers."""

from __future__ import annotations

import base64
import json
from datetime import timedelta

from django.test import TestCase, override_settings
from django.utils import timezone

from auditlog.application import query_service
from auditlog.domain.context import AuditQueryFilters
from auditlog.infrastructure.cursor import decode_cursor, encode_cursor
from auditlog.infrastructure.models import AuditEvent
from auditlog.infrastructure.query_builder import apply_filters


class AuditCursorTests(TestCase):
    def test_encode_decode_roundtrip(self):
        now = timezone.now()
        encoded = encode_cursor(now, 42)
        decoded = decode_cursor(encoded)
        if decoded is None:
            self.fail("decode_cursor returned None for a valid encoded cursor")
        ts, event_id = decoded
        self.assertEqual(event_id, 42)
        self.assertEqual(ts, now)

    def test_decode_cursor_handles_invalid_and_naive_payloads(self):
        self.assertIsNone(decode_cursor(""))
        self.assertIsNone(decode_cursor("%%%"))

        payload = {"ts": "2026-01-01T00:00:00", "id": 7}
        encoded = base64.urlsafe_b64encode(json.dumps(payload).encode("utf-8")).decode("ascii")
        decoded = decode_cursor(encoded)
        if decoded is None:
            self.fail("decode_cursor returned None for a valid payload")
        ts, event_id = decoded
        self.assertTrue(timezone.is_aware(ts))
        self.assertEqual(event_id, 7)


class AuditQueryComponentsTests(TestCase):
    def setUp(self):
        now = timezone.now()
        self.first = AuditEvent.objects.create(
            action="room.read",
            protocol="http",
            method="GET",
            status_code=200,
            success=True,
            ip="127.0.0.1",
            path="/api/chat/rooms/abc/",
            actor_user_id_snapshot=1,
            actor_username_snapshot="alice",
            metadata={"room_slug": "abc"},
        )
        self.second = AuditEvent.objects.create(
            action="room.write",
            protocol="http",
            method="POST",
            status_code=403,
            success=False,
            ip="10.0.0.1",
            path="/api/chat/rooms/xyz/",
            actor_user_id_snapshot=2,
            actor_username_snapshot="bob",
            metadata={"room_slug": "xyz"},
        )
        AuditEvent.objects.filter(pk=self.first.pk).update(created_at=now - timedelta(minutes=2))
        AuditEvent.objects.filter(pk=self.second.pk).update(created_at=now - timedelta(minutes=1))
        self.first.refresh_from_db()
        self.second.refresh_from_db()

    @override_settings(AUDIT_API_DEFAULT_LIMIT=10, AUDIT_API_MAX_LIMIT=20)
    def test_parse_filters_parses_all_fields_and_caps_limit(self):
        filters = query_service.parse_filters(
            {
                "actor_user_id": "1",
                "actor_username": "ali",
                "action": "room.read",
                "action_prefix": "room.",
                "protocol": "http",
                "method": "get",
                "status_code": "200",
                "success": "true",
                "ip": "127.0.0.1",
                "path_contains": "/chat/rooms",
                "date_from": self.first.created_at.isoformat(),
                "date_to": self.second.created_at.isoformat(),
                "room_slug": "abc",
                "limit": "999",
                "cursor": "cursor-token",
            }
        )
        self.assertEqual(filters.actor_user_id, 1)
        self.assertEqual(filters.actor_username, "ali")
        self.assertEqual(filters.method, "GET")
        self.assertEqual(filters.status_code, 200)
        self.assertTrue(filters.success)
        self.assertEqual(filters.limit, 20)
        self.assertEqual(filters.cursor, "cursor-token")

    def test_parse_filters_rejects_invalid_values(self):
        with self.assertRaises(ValueError):
            query_service.parse_filters({"limit": "0"})
        with self.assertRaises(ValueError):
            query_service.parse_filters({"actor_user_id": "bad"})
        with self.assertRaises(ValueError):
            query_service.parse_filters({"success": "unknown"})
        with self.assertRaises(ValueError):
            query_service.parse_filters({"date_from": "bad-date"})

    def test_apply_filters_and_cursor(self):
        cursor = encode_cursor(self.second.created_at, self.second.pk)
        filters = AuditQueryFilters(
            actor_user_id=1,
            actor_username="ali",
            action="room.read",
            action_prefix="room.",
            protocol="http",
            method="GET",
            status_code=200,
            success=True,
            ip="127.0.0.1",
            path_contains="/chat/rooms",
            date_from=self.first.created_at - timedelta(seconds=1),
            date_to=self.second.created_at,
            room_slug="abc",
            cursor=cursor,
        )
        filtered = apply_filters(AuditEvent.objects.all(), filters)
        self.assertEqual(list(filtered), [self.first])

    @override_settings(AUDIT_API_DEFAULT_LIMIT=1, AUDIT_API_MAX_LIMIT=3)
    def test_list_events_get_event_and_action_counts(self):
        filters = query_service.parse_filters({"limit": "1"})
        batch, next_cursor = query_service.list_events(filters)
        self.assertEqual(len(batch), 1)
        self.assertTrue(next_cursor)

        fetched = query_service.get_event(self.first.pk)
        if fetched is None:
            self.fail("Expected event to exist")
        self.assertEqual(fetched.pk, self.first.pk)
        self.assertIsNone(query_service.get_event(999999))

        counts = query_service.list_action_counts(
            AuditQueryFilters(
                action="room.read",
                action_prefix="room.",
                actor_username="",
            )
        )
        action_names = {item["action"] for item in counts}
        self.assertIn("room.read", action_names)
        self.assertIn("room.write", action_names)
