import json

from django.test import Client, RequestFactory, SimpleTestCase, TestCase, override_settings

from .models import Message
from .utils import build_profile_url, build_profile_url_from_request


class ApiTests(TestCase):
    def setUp(self):
        self.client = Client(enforce_csrf_checks=True)

    def _csrf(self):
        response = self.client.get("/api/auth/csrf/")
        return response.cookies["csrftoken"].value

    def test_public_room(self):
        response = self.client.get("/api/chat/public-room/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get("slug"), "public")

    def test_private_room_requires_auth(self):
        response = self.client.get("/api/chat/rooms/private123/")
        self.assertEqual(response.status_code, 401)

    def test_register_and_login(self):
        csrf = self._csrf()
        register_payload = {
            "username": "testuser",
            "password1": "pass12345",
            "password2": "pass12345",
        }
        response = self.client.post(
            "/api/auth/register/",
            data=json.dumps(register_payload),
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertIn(response.status_code, [200, 201])

        csrf = self._csrf()
        login_payload = {"username": "testuser", "password": "pass12345"}
        response = self.client.post(
            "/api/auth/login/",
            data=json.dumps(login_payload),
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(response.status_code, 200)


class RoomMessagesPaginationTests(TestCase):
    @override_settings(CHAT_MESSAGES_PAGE_SIZE=50, CHAT_MESSAGES_MAX_PAGE_SIZE=200)
    def test_room_messages_default_pagination(self):
        for i in range(60):
            Message.objects.create(
                username="user",
                room="public",
                message_content=f"message-{i}",
            )

        response = self.client.get("/api/chat/rooms/public/messages/")
        self.assertEqual(response.status_code, 200)
        payload = response.json()

        self.assertEqual(len(payload["messages"]), 50)
        self.assertTrue(payload["pagination"]["hasMore"])
        self.assertEqual(payload["pagination"]["limit"], 50)
        self.assertEqual(payload["pagination"]["nextBefore"], payload["messages"][0]["id"])

    def test_room_messages_invalid_limit_returns_400(self):
        response = self.client.get("/api/chat/rooms/public/messages/?limit=bad")
        self.assertEqual(response.status_code, 400)

    def test_room_messages_invalid_before_returns_400(self):
        response = self.client.get("/api/chat/rooms/public/messages/?before=0")
        self.assertEqual(response.status_code, 400)


class HealthApiTests(TestCase):
    def test_live_health_endpoint(self):
        response = self.client.get("/api/health/live/")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["check"], "live")

    def test_ready_health_endpoint(self):
        response = self.client.get("/api/health/ready/")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["check"], "ready")
        self.assertEqual(payload["components"]["database"], "ok")
        self.assertEqual(payload["components"]["cache"], "ok")


class BuildProfileUrlTests(SimpleTestCase):
    def _scope(self, headers=None, server=None, scheme="ws"):
        return {
            "headers": headers or [],
            "server": server,
            "scheme": scheme,
        }

    @override_settings(MEDIA_URL="/media/")
    def test_prefers_host_over_origin_for_local_dev(self):
        scope = self._scope(
            headers=[
                (b"origin", b"http://localhost:5173"),
                (b"host", b"localhost:8000"),
            ],
            server=("127.0.0.1", 8000),
            scheme="ws",
        )
        url = build_profile_url(scope, "profile_pics/a.jpg")
        self.assertEqual(url, "http://localhost:8000/media/profile_pics/a.jpg")

    @override_settings(MEDIA_URL="/media/")
    def test_prefers_origin_when_host_is_internal_but_origin_is_public(self):
        scope = self._scope(
            headers=[
                (b"origin", b"https://slowed.sbs"),
                (b"host", b"172.18.0.4:8000"),
            ],
            server=("172.18.0.4", 8000),
            scheme="ws",
        )
        url = build_profile_url(scope, "profile_pics/a.jpg")
        self.assertEqual(url, "https://slowed.sbs/media/profile_pics/a.jpg")

    @override_settings(MEDIA_URL="/media/")
    def test_falls_back_to_server(self):
        scope = self._scope(headers=[], server=("172.18.0.4", 8000), scheme="ws")
        url = build_profile_url(scope, "profile_pics/a.jpg")
        self.assertEqual(url, "http://172.18.0.4:8000/media/profile_pics/a.jpg")

    @override_settings(MEDIA_URL="/media/")
    def test_rewrites_internal_absolute_url(self):
        scope = self._scope(headers=[(b"origin", b"https://slowed.sbs")], scheme="wss")
        url = build_profile_url(scope, "http://172.18.0.4:8000/media/profile_pics/a.jpg")
        self.assertEqual(url, "https://slowed.sbs/media/profile_pics/a.jpg")

    def test_keeps_absolute_url(self):
        scope = self._scope()
        url = build_profile_url(scope, "https://cdn.example.com/a.jpg")
        self.assertEqual(url, "https://cdn.example.com/a.jpg")

    @override_settings(MEDIA_URL="/media/")
    def test_rejects_traversal_path(self):
        scope = self._scope(headers=[(b"host", b"example.com")], scheme="ws")
        url = build_profile_url(scope, "../secret.txt")
        self.assertIsNone(url)


class BuildProfileUrlFromRequestTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    @override_settings(MEDIA_URL="/media/", ALLOWED_HOSTS=["*"])
    def test_request_prefers_host_over_origin_for_local_dev(self):
        request = self.factory.get(
            "/api/auth/session/",
            HTTP_HOST="localhost:8000",
            HTTP_ORIGIN="http://localhost:5173",
        )
        url = build_profile_url_from_request(request, "profile_pics/a.jpg")
        self.assertEqual(url, "http://localhost:8000/media/profile_pics/a.jpg")

    @override_settings(MEDIA_URL="/media/", ALLOWED_HOSTS=["*"])
    def test_request_prefers_origin_when_host_is_internal_but_origin_is_public(self):
        request = self.factory.get(
            "/api/auth/session/",
            HTTP_HOST="172.18.0.4:8000",
            HTTP_ORIGIN="https://slowed.sbs",
        )
        url = build_profile_url_from_request(request, "profile_pics/a.jpg")
        self.assertEqual(url, "https://slowed.sbs/media/profile_pics/a.jpg")

    @override_settings(MEDIA_URL="/media/", PUBLIC_BASE_URL="https://cdn.slowed.sbs")
    def test_request_prefers_configured_public_base(self):
        request = self.factory.get("/api/auth/session/")
        url = build_profile_url_from_request(request, "profile_pics/a.jpg")
        self.assertEqual(url, "https://cdn.slowed.sbs/media/profile_pics/a.jpg")

    @override_settings(MEDIA_URL="/media/", ALLOWED_HOSTS=["*"])
    def test_request_rewrites_internal_absolute_url(self):
        request = self.factory.get(
            "/api/auth/session/",
            HTTP_HOST="127.0.0.1:8000",
            HTTP_ORIGIN="https://slowed.sbs",
        )
        url = build_profile_url_from_request(request, "http://127.0.0.1:8000/media/profile_pics/a.jpg")
        self.assertEqual(url, "https://slowed.sbs/media/profile_pics/a.jpg")

