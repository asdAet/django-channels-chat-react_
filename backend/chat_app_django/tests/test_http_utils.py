import json
from types import SimpleNamespace

from django.http.request import RawPostDataException
from django.test import SimpleTestCase

from chat_app_django.http_utils import error_response, parse_request_payload


class _BodyRaisesRequest:
    META = {"CONTENT_TYPE": "application/json"}
    POST = {"fallback": "1"}

    @property
    def body(self):
        raise RawPostDataException("body already read")


class HttpUtilsTests(SimpleTestCase):
    def test_parse_request_payload_returns_dict_from_json_body(self):
        request = SimpleNamespace(
            META={"CONTENT_TYPE": "application/json"},
            POST={},
            body=json.dumps({"email": "a@example.com"}).encode("utf-8"),
        )
        payload = parse_request_payload(request)
        self.assertEqual(payload, {"email": "a@example.com"})

    def test_parse_request_payload_falls_back_to_post_for_invalid_or_non_dict_json(self):
        invalid_json = SimpleNamespace(
            META={"CONTENT_TYPE": "application/json"},
            POST={"fallback": "2"},
            body=b"{bad",
        )
        array_json = SimpleNamespace(
            META={"CONTENT_TYPE": "application/json"},
            POST={"fallback": "3"},
            body=json.dumps([1, 2]).encode("utf-8"),
        )
        self.assertEqual(parse_request_payload(invalid_json), {"fallback": "2"})
        self.assertEqual(parse_request_payload(array_json), {"fallback": "3"})

    def test_parse_request_payload_handles_raw_post_data_exception(self):
        payload = parse_request_payload(_BodyRaisesRequest())
        self.assertEqual(payload, {"fallback": "1"})

    def test_parse_request_payload_uses_post_when_body_empty(self):
        request = SimpleNamespace(
            META={"CONTENT_TYPE": "application/json"},
            POST={"fallback": "4"},
            body=b"",
        )
        self.assertEqual(parse_request_payload(request), {"fallback": "4"})

    def test_error_response_includes_detail_and_errors(self):
        response = error_response(
            status=422,
            error="validation_error",
            detail="Invalid request",
            errors={"email": ["required"]},
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(
            response.data,
            {
                "error": "validation_error",
                "detail": "Invalid request",
                "errors": {"email": ["required"]},
            },
        )
