import json

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import Client, TestCase, override_settings

User = get_user_model()


class AuthApiTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = Client(enforce_csrf_checks=True)

    def _csrf(self) -> str:
        response = self.client.get('/api/auth/csrf/')
        self.assertEqual(response.status_code, 200)
        self.assertIn('csrftoken', response.cookies)
        return response.cookies['csrftoken'].value

    def test_csrf_endpoint_returns_token(self):
        response = self.client.get('/api/auth/csrf/')
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn('csrfToken', payload)
        self.assertTrue(payload['csrfToken'])

    def test_register_success(self):
        csrf = self._csrf()
        response = self.client.post(
            '/api/auth/register/',
            data=json.dumps(
                {
                    'username': 'new_user',
                    'password1': 'pass12345',
                    'password2': 'pass12345',
                }
            ),
            content_type='application/json',
            HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(response.status_code, 201)
        payload = response.json()
        self.assertTrue(payload.get('authenticated'))
        self.assertEqual(payload.get('user', {}).get('username'), 'new_user')

    def test_register_duplicate_username_returns_field_error(self):
        User.objects.create_user(username='taken_name', password='pass12345')
        csrf = self._csrf()
        response = self.client.post(
            '/api/auth/register/',
            data=json.dumps(
                {
                    'username': 'taken_name',
                    'password1': 'pass12345',
                    'password2': 'pass12345',
                }
            ),
            content_type='application/json',
            HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertIn('errors', payload)
        self.assertIn('username', payload['errors'])

    def test_register_rejects_long_username(self):
        csrf = self._csrf()
        response = self.client.post(
            '/api/auth/register/',
            data=json.dumps(
                {
                    'username': 'a' * 14,
                    'password1': 'pass12345',
                    'password2': 'pass12345',
                }
            ),
            content_type='application/json',
            HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertIn('errors', payload)
        self.assertIn('username', payload['errors'])

    @override_settings(
        AUTH_PASSWORD_VALIDATORS=[
            {
                'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
                'OPTIONS': {'min_length': 12},
            }
        ]
    )
    def test_register_weak_password_returns_password_error(self):
        csrf = self._csrf()
        response = self.client.post(
            '/api/auth/register/',
            data=json.dumps(
                {
                    'username': 'weak_user',
                    'password1': 'short1',
                    'password2': 'short1',
                }
            ),
            content_type='application/json',
            HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertIn('errors', payload)
        self.assertIn('password', payload['errors'])

    def test_login_invalid_credentials(self):
        csrf = self._csrf()
        response = self.client.post(
            '/api/auth/login/',
            data=json.dumps({'username': 'ghost', 'password': 'wrong'}),
            content_type='application/json',
            HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertIn('errors', payload)
        self.assertIn('credentials', payload['errors'])

    def test_login_success_and_session(self):
        User.objects.create_user(username='login_user', password='pass12345')

        csrf = self._csrf()
        login_response = self.client.post(
            '/api/auth/login/',
            data=json.dumps({'username': 'login_user', 'password': 'pass12345'}),
            content_type='application/json',
            HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(login_response.status_code, 200)
        self.assertTrue(login_response.json().get('authenticated'))

        session_response = self.client.get('/api/auth/session/')
        self.assertEqual(session_response.status_code, 200)
        payload = session_response.json()
        self.assertTrue(payload.get('authenticated'))
        self.assertEqual(payload.get('user', {}).get('username'), 'login_user')

    @override_settings(AUTH_RATE_LIMIT=1, AUTH_RATE_WINDOW=60)
    def test_login_rate_limit(self):
        csrf = self._csrf()
        first = self.client.post(
            '/api/auth/login/',
            data=json.dumps({'username': 'ghost', 'password': 'wrong'}),
            content_type='application/json',
            HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(first.status_code, 400)

        csrf = self._csrf()
        second = self.client.post(
            '/api/auth/login/',
            data=json.dumps({'username': 'ghost', 'password': 'wrong'}),
            content_type='application/json',
            HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(second.status_code, 429)

    def test_password_rules_endpoint(self):
        response = self.client.get('/api/auth/password-rules/')
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn('rules', payload)
        self.assertIsInstance(payload['rules'], list)

