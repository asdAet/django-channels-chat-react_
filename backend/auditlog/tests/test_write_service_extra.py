"""Additional branch coverage for auditlog.application.write_service."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import AnonymousUser
from django.db import OperationalError
from django.test import RequestFactory, TestCase
from django.urls import ResolverMatch

from auditlog.application import write_service

User = get_user_model()


class AuditWriteServiceExtraTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()

    def test_normalize_scope_and_request_id_helpers(self):
        self.assertIsNone(write_service._normalize_int("bad"))
        self.assertEqual(write_service._normalize_int("7"), 7)

        scope = {"headers": [(b"x-request-id", b"abc")]}
        self.assertEqual(write_service._scope_header(scope, b"x-request-id"), "abc")

        scope_with_bad_utf = {"headers": [(b"x-request-id", b"\xff")]}
        self.assertEqual(write_service._scope_header(scope_with_bad_utf, b"x-request-id"), "ÿ")

        request = self.factory.get("/", HTTP_X_REQUEST_ID="req-1")
        self.assertEqual(write_service._get_or_create_request_id_for_request(request), "req-1")

        request_no_header = self.factory.get("/")
        generated = write_service._get_or_create_request_id_for_request(request_no_header)
        self.assertEqual(len(generated), 32)

        ws_scope = {"headers": [(b"x-request-id", b"ws-1")]}
        self.assertEqual(write_service._get_or_create_request_id_for_scope(ws_scope), "ws-1")
        self.assertEqual(ws_scope["audit_request_id"], "ws-1")

    def test_extract_actor_and_safe_metadata_branches(self):
        user = User.objects.create_user(username="audit_user", password="pass12345")
        extracted = write_service._extract_actor(
            actor_user=user,
            actor_user_id="9",
            actor_username="name",
            is_authenticated=True,
        )
        self.assertEqual(extracted[1], 9)
        self.assertEqual(extracted[2], "name")
        self.assertTrue(extracted[3])

        unauth = write_service._extract_actor(
            actor_user=user,
            actor_user_id="9",
            actor_username="name",
            is_authenticated=False,
        )
        self.assertIsNone(unauth[0])

        self.assertEqual(write_service._safe_metadata(None), {})
        self.assertEqual(write_service._safe_metadata({"k": "v"}), {"k": "v"})
        self.assertEqual(write_service._safe_metadata("raw"), {"value": "raw"})

    def test_persist_event_row_handles_db_errors(self):
        with patch(
            "auditlog.application.write_service.AuditEventRepository.create",
            side_effect=OperationalError,
        ), patch("auditlog.application.write_service._internal_logger.exception") as logger_mock:
            write_service._persist_event_row({"action": "x"})
        logger_mock.assert_called_once()

    def test_persist_event_uses_async_loop_when_available(self):
        fake_loop = Mock()
        fake_loop.create_task.side_effect = lambda coro: coro.close()
        with patch("auditlog.application.write_service.asyncio.get_running_loop", return_value=fake_loop):
            write_service._persist_event({"action": "x"})
        fake_loop.create_task.assert_called_once()

    def test_write_event_logs_and_persists_payload(self):
        with patch("auditlog.application.write_service._persist_event") as persist_mock, patch(
            "auditlog.application.write_service._audit_logger.info"
        ) as logger_mock, patch(
            "auditlog.application.write_service.sanitize_value",
            side_effect=lambda payload: payload,
        ):
            write_service.write_event(
                "custom.event",
                protocol="http",
                method="GET",
                path="/x",
                status_code=201,
                actor_user_id="12",
                actor_username="actor",
                metadata={"extra": "value"},
            )

        logger_mock.assert_called_once()
        persist_mock.assert_called_once()
        persisted_payload = persist_mock.call_args.args[0]
        self.assertEqual(persisted_payload["action"], "custom.event")
        self.assertEqual(persisted_payload["actor_user_id_snapshot"], 12)
        self.assertEqual(persisted_payload["actor_username_snapshot"], "actor")

    def test_audit_http_and_ws_helpers_forward_to_write_event(self):
        request = self.factory.get("/api/test/?a=1")
        request.user = AnonymousUser()

        with patch("auditlog.application.write_service.write_event") as write_event_mock:
            write_service.audit_http_event("http.event", request, reason="x")
            write_service.audit_ws_event(
                "ws.event",
                {"path": "/ws", "headers": [(b"x-request-id", b"ws-id")], "user": None},
                reason="y",
            )

        self.assertEqual(write_event_mock.call_count, 2)

    def test_audit_http_request_collects_query_and_exception(self):
        request = self.factory.get("/api/test/?a=1&b=2")
        request.user = AnonymousUser()
        request.resolver_match = ResolverMatch(
            func=lambda _request: None,
            args=(),
            kwargs={},
            url_name="api-test",
            app_names=[],
            namespaces=[],
            route="/api/test/",
        )

        with patch("auditlog.application.write_service.write_event") as write_event_mock:
            write_service.audit_http_request(request, response=SimpleNamespace(status_code=200))
            write_service.audit_http_request(request, response=None, exception=RuntimeError("boom"))

        self.assertEqual(write_event_mock.call_count, 2)
        normal_call = write_event_mock.call_args_list[0]
        exc_call = write_event_mock.call_args_list[1]
        self.assertEqual(normal_call.args[0], "http.request")
        self.assertEqual(exc_call.args[0], "http.exception")
