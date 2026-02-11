import io
import tempfile

from PIL import Image
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings

from .forms import ProfileUpdateForm, UserUpdateForm
from .models import Profile

User = get_user_model()


class UserFormsTests(TestCase):
    def test_user_update_allows_same_email_for_current_user(self):
        user = User.objects.create_user(
            username="user1",
            password="pass12345",
            email="same@example.com",
        )
        form = UserUpdateForm(
            data={"username": "user1", "email": "same@example.com"},
            instance=user,
        )
        self.assertTrue(form.is_valid())

    def test_user_update_rejects_duplicate_email_case_insensitive(self):
        User.objects.create_user(
            username="user1",
            password="pass12345",
            email="mail@example.com",
        )
        user2 = User.objects.create_user(
            username="user2",
            password="pass12345",
            email="other@example.com",
        )
        form = UserUpdateForm(
            data={"username": "user2", "email": "MAIL@example.com"},
            instance=user2,
        )
        self.assertFalse(form.is_valid())
        self.assertIn("email", form.errors)

    def test_profile_form_strips_html_from_bio(self):
        user = User.objects.create_user(username="userbio", password="pass12345")
        profile = user.profile
        form = ProfileUpdateForm(
            data={"bio": "<b>Hello</b> <script>alert(1)</script>"},
            instance=profile,
        )
        self.assertTrue(form.is_valid())
        cleaned_bio = form.cleaned_data["bio"]
        self.assertNotIn("<", cleaned_bio)
        self.assertNotIn(">", cleaned_bio)


class ProfileImageProcessingTests(TestCase):
    def setUp(self):
        self.temp_media = tempfile.TemporaryDirectory()
        self.override_media = override_settings(MEDIA_ROOT=self.temp_media.name)
        self.override_media.enable()

    def tearDown(self):
        self.override_media.disable()
        self.temp_media.cleanup()

    @staticmethod
    def _make_rgba_upload_with_jpg_name() -> SimpleUploadedFile:
        image = Image.new("RGBA", (800, 600), (255, 0, 0, 120))
        buf = io.BytesIO()
        image.save(buf, format="PNG")
        buf.seek(0)
        return SimpleUploadedFile("avatar.jpg", buf.getvalue(), content_type="image/png")

    def test_profile_save_converts_rgba_for_jpeg_extension(self):
        user = User.objects.create_user(username="imguser", password="pass12345")
        profile = user.profile
        profile.image = self._make_rgba_upload_with_jpg_name()

        profile.save()
        profile.refresh_from_db()

        with Image.open(profile.image.path) as saved:
            self.assertLessEqual(saved.width, 300)
            self.assertLessEqual(saved.height, 300)
            self.assertNotEqual(saved.mode, "RGBA")


class UserSignalsTests(TestCase):
    def test_profile_created_for_new_user(self):
        user = User.objects.create_user(username="signaluser", password="pass12345")
        self.assertTrue(Profile.objects.filter(user=user).exists())
