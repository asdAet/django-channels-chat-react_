import io

from PIL import Image
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase

User = get_user_model()


class ProfileApiTests(TestCase):
    def setUp(self):
        self.client = Client(enforce_csrf_checks=True)
        self.user = User.objects.create_user(
            username='profile_user',
            password='pass12345',
            email='profile@example.com',
        )
        self.other = User.objects.create_user(
            username='other_user',
            password='pass12345',
            email='other@example.com',
        )

    def _csrf(self) -> str:
        response = self.client.get('/api/auth/csrf/')
        return response.cookies['csrftoken'].value

    @staticmethod
    def _image_upload(filename: str = 'avatar.png') -> SimpleUploadedFile:
        image = Image.new('RGB', (20, 20), (30, 60, 90))
        buff = io.BytesIO()
        image.save(buff, format='PNG')
        buff.seek(0)
        return SimpleUploadedFile(filename, buff.read(), content_type='image/png')

    def test_profile_requires_auth(self):
        response = self.client.get('/api/auth/profile/')
        self.assertEqual(response.status_code, 401)

    def test_get_profile_authenticated(self):
        self.client.force_login(self.user)
        response = self.client.get('/api/auth/profile/')
        self.assertEqual(response.status_code, 200)
        payload = response.json()['user']
        self.assertEqual(payload['username'], self.user.username)
        self.assertEqual(payload['email'], self.user.email)
        self.assertIn('bio', payload)
        self.assertIn('lastSeen', payload)

    def test_profile_update_allows_same_username(self):
        self.client.force_login(self.user)
        csrf = self._csrf()
        response = self.client.post(
            '/api/auth/profile/',
            data={
                'username': self.user.username,
                'email': self.user.email,
                'bio': 'updated',
            },
            HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertEqual(self.user.username, 'profile_user')
        self.assertEqual(self.user.profile.bio, 'updated')

    def test_profile_update_rejects_duplicate_username(self):
        self.client.force_login(self.user)
        csrf = self._csrf()
        response = self.client.post(
            '/api/auth/profile/',
            data={
                'username': self.other.username,
                'email': self.user.email,
            },
            HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertIn('errors', payload)
        self.assertIn('username', payload['errors'])

    def test_profile_update_rejects_long_username(self):
        self.client.force_login(self.user)
        csrf = self._csrf()
        response = self.client.post(
            '/api/auth/profile/',
            data={
                'username': 'a' * 14,
                'email': self.user.email,
            },
            HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertIn('errors', payload)
        self.assertIn('username', payload['errors'])

    def test_profile_update_rejects_duplicate_email(self):
        self.client.force_login(self.user)
        csrf = self._csrf()
        response = self.client.post(
            '/api/auth/profile/',
            data={
                'username': self.user.username,
                'email': self.other.email,
            },
            HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertIn('errors', payload)
        self.assertIn('email', payload['errors'])

    def test_profile_update_sanitizes_bio(self):
        self.client.force_login(self.user)
        csrf = self._csrf()
        response = self.client.post(
            '/api/auth/profile/',
            data={
                'username': self.user.username,
                'email': self.user.email,
                'bio': '<b>Hello</b> <script>alert(1)</script>',
            },
            HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertEqual(self.user.profile.bio, 'Hello alert(1)')

    def test_profile_update_image_upload(self):
        self.client.force_login(self.user)
        csrf = self._csrf()
        response = self.client.post(
            '/api/auth/profile/',
            data={
                'username': self.user.username,
                'email': self.user.email,
                'bio': 'has image',
                'image': self._image_upload(),
            },
            HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()['user']
        self.assertIn('/media/profile_pics/', payload['profileImage'])

    def test_public_profile_hides_email(self):
        response = self.client.get(f'/api/auth/users/{self.user.username}/')
        self.assertEqual(response.status_code, 200)
        payload = response.json()['user']
        self.assertEqual(payload['username'], self.user.username)
        self.assertEqual(payload['email'], '')
        self.assertIn('lastSeen', payload)
