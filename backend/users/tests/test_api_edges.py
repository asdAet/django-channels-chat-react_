# pyright: reportAttributeAccessIssue=false
"""Содержит тесты модуля `test_api_edges` подсистемы `users`."""


import json
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import OperationalError
from django.http.request import RawPostDataException
from django.test import Client, RequestFactory, SimpleTestCase, TestCase

from chat_app_django.http_utils import parse_request_payload
from users import api
from users.identity import ensure_profile

User = get_user_model()


class _BodyRaisesRequest:
    """Группирует тестовые сценарии класса `_BodyRaisesRequest`."""
    META = {'CONTENT_TYPE': 'application/json'}

    def __init__(self, post=None):
        """Проверяет сценарий `__init__`."""
        self.POST = post or {}

    @property
    def body(self):
        """Проверяет сценарий `body`."""
        raise RawPostDataException('stream already consumed')


class _InvalidJsonRequest:
    """Группирует тестовые сценарии класса `_InvalidJsonRequest`."""
    META = {'CONTENT_TYPE': 'application/json'}

    def __init__(self, body: bytes, post=None):
        """Проверяет сценарий `__init__`."""
        self._body = body
        self.POST = post or {}

    @property
    def body(self):
        """Проверяет сценарий `body`."""
        return self._body


class UsersApiHelpersTests(SimpleTestCase):
    """Группирует тестовые сценарии класса `UsersApiHelpersTests`."""
    def setUp(self):
        """Проверяет сценарий `setUp`."""
        self.factory = RequestFactory()

    def test_parse_body_returns_post_for_form_content_type(self):
        """Проверяет сценарий `test_parse_body_returns_post_for_form_content_type`."""
        request = SimpleNamespace(
            META={'CONTENT_TYPE': 'multipart/form-data'},
            POST={'username': 'form-user'},
        )
        self.assertEqual(parse_request_payload(request), {'username': 'form-user'})

    def test_parse_body_handles_raw_post_data_exception(self):
        """Проверяет сценарий `test_parse_body_handles_raw_post_data_exception`."""
        request = _BodyRaisesRequest(post={'username': 'fallback'})
        self.assertEqual(parse_request_payload(request), {'username': 'fallback'})

    def test_parse_body_invalid_json_falls_back_to_empty_dict(self):
        """Проверяет сценарий `test_parse_body_invalid_json_falls_back_to_empty_dict`."""
        request = _InvalidJsonRequest(body=b'{bad-json', post={})
        self.assertEqual(parse_request_payload(request), {})

    def test_identity_error_response_returns_error_and_errors_fields(self):
        """Проверяет сценарий `test_identity_error_response_returns_error_and_errors_fields`."""
        from users.application.errors import IdentityServiceError

        response = api._identity_error_response(
            IdentityServiceError("Ошибка валидации", errors={"email": ["Укажите email"]})
        )
        self.assertEqual(response.status_code, 400)
        payload = response.data
        if not isinstance(payload, dict):
            self.fail("Expected response payload to be a dict")
        self.assertEqual(payload["error"], "Ошибка валидации")
        self.assertEqual(payload["errors"], {"email": ["Укажите email"]})

    def test_public_profile_view_returns_404_when_username_empty(self):
        """Проверяет сценарий `test_public_profile_view_returns_404_when_username_empty`."""
        request = self.factory.get('/api/auth/users//')
        response = api.public_profile_view(request, username='')
        self.assertEqual(response.status_code, 404)


class AuthApiEdgeTests(TestCase):
    """Группирует тестовые сценарии класса `AuthApiEdgeTests`."""
    def setUp(self):
        """Проверяет сценарий `setUp`."""
        cache.clear()
        self.client = Client(enforce_csrf_checks=True)
        self.user = User.objects.create_user(username='auth_edge_user', password='pass12345')

    def _csrf(self) -> str:
        """Проверяет сценарий `_csrf`."""
        response = self.client.get('/api/auth/csrf/')
        return response.cookies['csrftoken'].value

    def test_session_view_for_guest(self):
        """Проверяет сценарий `test_session_view_for_guest`."""
        response = self.client.get('/api/auth/session/')
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()['authenticated'])

    def test_login_rejects_empty_json_body(self):
        """Проверяет сценарий `test_login_rejects_empty_json_body`."""
        csrf = self._csrf()
        response = self.client.post(
            '/api/auth/login/',
            data=json.dumps({}),
            content_type='application/json',
            HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('credentials', response.json()['errors'])

    def test_login_requires_both_username_and_password(self):
        """Проверяет сценарий `test_login_requires_both_username_and_password`."""
        csrf = self._csrf()
        response = self.client.post(
            '/api/auth/login/',
            data=json.dumps({'email': 'only-name@example.com'}),
            content_type='application/json',
            HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('credentials', response.json()['errors'])

    def test_register_get_returns_usage_hint(self):
        """Проверяет сценарий `test_register_get_returns_usage_hint`."""
        response = self.client.get('/api/auth/register/')
        self.assertEqual(response.status_code, 405)

    def test_register_rejects_empty_payload(self):
        """Проверяет сценарий `test_register_rejects_empty_payload`."""
        csrf = self._csrf()
        response = self.client.post(
            '/api/auth/register/',
            data=json.dumps({}),
            content_type='application/json',
            HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('email', response.json()['errors'])

    def test_register_rejects_missing_username(self):
        """Проверяет сценарий `test_register_rejects_missing_username`."""
        csrf = self._csrf()
        response = self.client.post(
            '/api/auth/register/',
            data=json.dumps({'name': 'Edge User', 'password1': 'pass12345', 'password2': 'pass12345'}),
            content_type='application/json',
            HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('email', response.json()['errors'])

    def test_register_rejects_missing_password(self):
        """Проверяет сценарий `test_register_rejects_missing_password`."""
        csrf = self._csrf()
        response = self.client.post(
            '/api/auth/register/',
            data=json.dumps({'email': 'edge_user@example.com'}),
            content_type='application/json',
            HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('password', response.json()['errors'])

    def test_register_rejects_password_mismatch(self):
        """Проверяет сценарий `test_register_rejects_password_mismatch`."""
        csrf = self._csrf()
        response = self.client.post(
            '/api/auth/register/',
            data=json.dumps(
                {
                    'email': 'edge_user@example.com',
                    'password1': 'pass12345',
                    'password2': 'pass54321',
                }
            ),
            content_type='application/json',
            HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('password', response.json()['errors'])

    def test_register_returns_summary_for_non_password_form_errors(self):
        """Проверяет сценарий `test_register_returns_summary_for_non_password_form_errors`."""
        csrf = self._csrf()
        first = self.client.post(
            '/api/auth/register/',
            data=json.dumps(
                {
                    'email': 'duplicate@example.com',
                    'password1': 'pass12345',
                    'password2': 'pass12345',
                }
            ),
            content_type='application/json',
            HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(first.status_code, 201)

        csrf = self._csrf()
        response = self.client.post(
            '/api/auth/register/',
            data=json.dumps(
                {
                    'email': 'duplicate@example.com',
                    'password1': 'pass12345',
                    'password2': 'pass12345',
                }
            ),
            content_type='application/json',
            HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(response.status_code, 409)
        payload = response.json()
        self.assertIn('errors', payload)
        self.assertIn('email', payload['errors'])
        self.assertTrue(payload['error'])

    def test_logout_handles_operational_error_when_updating_last_seen(self):
        """Проверяет сценарий `test_logout_handles_operational_error_when_updating_last_seen`."""
        self.client.force_login(self.user)
        csrf = self._csrf()

        profile = ensure_profile(self.user)
        with patch.object(type(profile), 'save', side_effect=OperationalError):
            response = self.client.post('/api/auth/logout/', HTTP_X_CSRFTOKEN=csrf)

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['ok'])

    def test_public_profile_not_found(self):
        """Проверяет сценарий `test_public_profile_not_found`."""
        response = self.client.get('/api/auth/users/missing-user/')
        self.assertEqual(response.status_code, 404)

