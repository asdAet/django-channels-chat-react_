from unittest.mock import patch

from django.db import IntegrityError
from django.test import TestCase

from chat_app_django.security.rate_limit import DbRateLimiter, RateLimitPolicy


class RateLimitServiceTests(TestCase):
    def test_policy_normalization_clamps_values(self):
        policy = RateLimitPolicy(limit=0, window_seconds=-5)
        self.assertEqual(policy.normalized_limit(), 1)
        self.assertEqual(policy.normalized_window(), 1)

    def test_empty_scope_key_is_fail_closed(self):
        policy = RateLimitPolicy(limit=2, window_seconds=10)
        self.assertTrue(DbRateLimiter.is_limited(scope_key="", policy=policy))

    def test_integrity_error_retries_and_fails_closed_after_max_attempts(self):
        policy = RateLimitPolicy(limit=2, window_seconds=10)
        with patch(
            "chat_app_django.security.rate_limit.SecurityRateLimitBucket.objects.select_for_update",
            side_effect=IntegrityError("race"),
        ):
            self.assertTrue(DbRateLimiter.is_limited(scope_key="auth:login:1.2.3.4", policy=policy))

    def test_unexpected_exception_is_fail_closed(self):
        policy = RateLimitPolicy(limit=2, window_seconds=10)
        with patch(
            "chat_app_django.security.rate_limit.SecurityRateLimitBucket.objects.select_for_update",
            side_effect=RuntimeError("boom"),
        ):
            self.assertTrue(DbRateLimiter.is_limited(scope_key="auth:login:5.6.7.8", policy=policy))
