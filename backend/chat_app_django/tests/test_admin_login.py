"""Admin auth regression tests."""

from django.contrib.auth import get_user_model
from django.test import TestCase


User = get_user_model()


class AdminLoginTests(TestCase):
    def test_createsuperuser_credentials_work_in_admin_login(self):
        user = User.objects.create_superuser(
            username="admin",
            email="admin@example.com",
            password="adminpass123",
        )

        response = self.client.post(
            "/admin/login/?next=/admin/",
            {
                "username": "admin",
                "password": "adminpass123",
                "next": "/admin/",
            },
        )

        self.assertEqual(response.status_code, 302)
        self.assertTrue(response["Location"].endswith("/admin/"))
        self.assertEqual(self.client.session.get("_auth_user_id"), str(user.pk))
