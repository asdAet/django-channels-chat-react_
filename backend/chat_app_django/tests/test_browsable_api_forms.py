"""Tests for Browsable API HTML forms used in manual testing."""

from django.contrib.auth import get_user_model
from django.test import TestCase


User = get_user_model()


class BrowsableApiFormsTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="browsable_user", password="pass12345")
        self.peer = User.objects.create_user(username="browsable_peer", password="pass12345")

    def _get_html(self, path: str, expected_status: int = 200) -> str:
        response = self.client.get(path, HTTP_ACCEPT="text/html")
        self.assertEqual(response.status_code, expected_status)
        if expected_status == 200:
            self.assertIn("text/html", response["Content-Type"])
        return response.content.decode("utf-8", errors="ignore")

    def test_login_endpoint_rejects_get_for_browsable_form(self):
        self._get_html("/api/auth/login/", expected_status=405)

    def test_register_endpoint_rejects_get_for_browsable_form(self):
        self._get_html("/api/auth/register/", expected_status=405)

    def test_direct_start_form_shows_username_for_authenticated_user(self):
        self.client.force_login(self.user)
        html = self._get_html("/api/chat/direct/start/")
        self.assertIn('name="username"', html)

    def test_profile_form_shows_profile_update_fields_for_authenticated_user(self):
        self.client.force_login(self.user)
        html = self._get_html("/api/auth/profile/")
        self.assertIn('name="_content_type"', html)
        self.assertIn('name="_content"', html)

    def test_friends_send_request_form_shows_username_for_authenticated_user(self):
        self.client.force_login(self.user)
        html = self._get_html("/api/friends/requests/")
        self.assertIn('name="username"', html)

    def test_friends_block_form_shows_username_for_authenticated_user(self):
        self.client.force_login(self.user)
        html = self._get_html("/api/friends/block/")
        self.assertIn('name="username"', html)
