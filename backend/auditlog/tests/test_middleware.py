from django.contrib.auth import get_user_model
from django.test import TestCase
from types import SimpleNamespace
from unittest.mock import patch

from auditlog.interfaces.middleware import AuditHttpMiddleware
from auditlog.models import AuditEvent

User = get_user_model()


class AuditMiddlewareTests(TestCase):
    def test_request_is_saved_to_audit_events(self):
        user = User.objects.create_user(username="audit_http_user", password="pass12345")
        self.client.force_login(user)

        response = self.client.get("/api/auth/session/")
        self.assertEqual(response.status_code, 200)

        self.assertTrue(
            AuditEvent.objects.filter(
                action="http.request",
                path="/api/auth/session/",
                actor_user_id_snapshot=user.pk,
                status_code=200,
            ).exists()
        )

    def test_health_endpoints_are_skipped(self):
        self.client.get("/api/health/live/")
        self.assertFalse(AuditEvent.objects.filter(path="/api/health/live/").exists())

    def test_static_endpoints_are_skipped(self):
        self.client.get("/static/app.js")
        self.assertFalse(AuditEvent.objects.filter(path="/static/app.js").exists())

    def test_middleware_audits_and_reraises_exceptions(self):
        request = SimpleNamespace(path="/api/fail/")

        def _raise(_request):
            raise RuntimeError("boom")

        middleware = AuditHttpMiddleware(_raise)
        with patch("auditlog.interfaces.middleware.audit_http_request") as mocked_audit:
            with self.assertRaises(RuntimeError):
                middleware(request)

        mocked_audit.assert_called_once()
        args, kwargs = mocked_audit.call_args
        self.assertEqual(args[0], request)
        self.assertIsNone(kwargs["response"])
        self.assertIsInstance(kwargs["exception"], RuntimeError)

