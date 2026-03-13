"""Coverage tests for custom auth backends."""

from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import make_password
from django.test import RequestFactory, TestCase

from users.auth_backends import EmailIdentityBackend
from users.models import EmailIdentity

User = get_user_model()


class EmailIdentityBackendTests(TestCase):
    def setUp(self):
        self.backend = EmailIdentityBackend()
        self.request = RequestFactory().post("/api/auth/login/")
        self.user = User.objects.create_user(username="backend_user", email="backend@example.com")
        self.user.set_unusable_password()
        self.user.save(update_fields=["password"])
        EmailIdentity.objects.create(
            user=self.user,
            email_normalized="backend@example.com",
            password_hash=make_password("pass12345"),
        )

    def test_authenticate_returns_user_for_valid_credentials(self):
        result = self.backend.authenticate(
            request=self.request,
            email="  BACKEND@example.com  ",
            password="pass12345",
        )
        self.assertEqual(result, self.user)

    def test_authenticate_returns_none_for_invalid_inputs(self):
        self.assertIsNone(self.backend.authenticate(request=self.request, email="", password="pass12345"))
        self.assertIsNone(
            self.backend.authenticate(request=self.request, email="backend@example.com", password="")
        )
        self.assertIsNone(
            self.backend.authenticate(
                request=self.request,
                email="missing@example.com",
                password="pass12345",
            )
        )
        self.assertIsNone(
            self.backend.authenticate(
                request=self.request,
                email="backend@example.com",
                password="wrong",
            )
        )

    def test_get_user_returns_user_or_none(self):
        self.assertEqual(self.backend.get_user(self.user.pk), self.user)
        self.assertIsNone(self.backend.get_user(999999))
