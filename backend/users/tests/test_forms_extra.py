"""Additional coverage tests for users.forms."""

from __future__ import annotations

from unittest.mock import patch

from django import forms
from django.contrib.auth import get_user_model
from django.test import TestCase

from users.forms import (
    EmailRegisterForm,
    ProfileIdentityUpdateForm,
    ProfileUpdateForm,
    UserUpdateForm,
    _validate_username_symbols,
)
from users.identity import ensure_profile
from users.models import EmailIdentity

User = get_user_model()


class UsersFormsExtraTests(TestCase):
    def test_validate_username_symbols_rejects_non_letters(self):
        with self.assertRaises(forms.ValidationError):
            _validate_username_symbols("user_1")
        _validate_username_symbols("OnlyLetters")

    def test_email_register_form_detects_duplicate_email(self):
        user = User.objects.create_user(username="dup_mail_user", email="dup@example.com")
        user.set_unusable_password()
        user.save(update_fields=["password"])
        EmailIdentity.objects.create(
            user=user,
            email_normalized="dup@example.com",
            password_hash="hashed",
        )

        form = EmailRegisterForm(
            data={"email": " DUP@example.com ", "password1": "pass12345", "password2": "pass12345"}
        )
        self.assertFalse(form.is_valid())
        self.assertIn("email", form.errors)

    def test_email_register_form_clean_email_handles_empty_normalized_value(self):
        form = EmailRegisterForm()
        form.cleaned_data = {"email": None}
        with self.assertRaises(forms.ValidationError):
            form.clean_email()

    def test_email_register_form_password_mismatch(self):
        form = EmailRegisterForm(
            data={"email": "new@example.com", "password1": "pass12345", "password2": "wrong"}
        )
        self.assertFalse(form.is_valid())
        self.assertIn("password2", form.errors)

    def test_email_register_form_clean_returns_early_when_passwords_missing(self):
        form = EmailRegisterForm()
        form.cleaned_data = {"email": "x@example.com", "password1": "", "password2": ""}
        cleaned = form.clean()
        self.assertEqual(cleaned, form.cleaned_data)

    def test_email_register_form_password_validation_branches(self):
        with patch("users.forms.password_validation.validate_password", side_effect=forms.ValidationError("weak")):
            weak_form = EmailRegisterForm(
                data={"email": "new@example.com", "password1": "pass12345", "password2": "pass12345"}
            )
            self.assertFalse(weak_form.is_valid())
            self.assertIn("password1", weak_form.errors)

        with patch("users.forms.password_validation.validate_password", side_effect=RuntimeError):
            error_form = EmailRegisterForm(
                data={"email": "new2@example.com", "password1": "pass12345", "password2": "pass12345"}
            )
            self.assertFalse(error_form.is_valid())
            self.assertIn("password1", error_form.errors)

    def test_profile_identity_update_form_validates_and_saves(self):
        user = User.objects.create_user(username="identity_user", password="pass12345")
        profile = ensure_profile(user)

        duplicate_user = User.objects.create_user(username="duplicate_user", password="pass12345")
        duplicate_profile = ensure_profile(duplicate_user)
        duplicate_profile.username = "TakenName"
        duplicate_profile.save(update_fields=["username"])

        duplicate = ProfileIdentityUpdateForm(
            data={"name": "<b>New Name</b>", "username": "TakenName"},
            user=user,
        )
        self.assertFalse(duplicate.is_valid())
        self.assertIn("username", duplicate.errors)

        invalid_symbols = ProfileIdentityUpdateForm(data={"username": "bad_name"}, user=user)
        self.assertFalse(invalid_symbols.is_valid())
        self.assertIn("username", invalid_symbols.errors)

        valid = ProfileIdentityUpdateForm(data={"name": "<i>Name</i>", "username": "ValidName"}, user=user)
        self.assertTrue(valid.is_valid(), valid.errors)
        updated = valid.save(profile)
        self.assertEqual(updated.name, "Name")
        self.assertEqual(updated.username, "ValidName")

    def test_profile_identity_update_form_handles_none_and_blank_username(self):
        user = User.objects.create_user(username="identity_none", password="pass12345")
        form_none = ProfileIdentityUpdateForm(data={"name": "Only Name"}, user=user)
        self.assertTrue(form_none.is_valid(), form_none.errors)
        self.assertIsNone(form_none.cleaned_data["username"])

        form_blank = ProfileIdentityUpdateForm(data={"username": "   "}, user=user)
        self.assertTrue(form_blank.is_valid(), form_blank.errors)
        self.assertIsNone(form_blank.cleaned_data["username"])

    def test_user_update_form_allows_empty_values(self):
        user = User.objects.create_user(username="upd_user", password="pass12345")
        form = UserUpdateForm(data={"username": "upd_user", "email": ""}, instance=user)
        self.assertTrue(form.is_valid(), form.errors)
        self.assertEqual(form.cleaned_data["username"], "upd_user")
        self.assertEqual(form.cleaned_data["email"], "")

    def test_profile_update_form_save_commit_false_and_clean_image_without_file(self):
        user = User.objects.create_user(username="profile_upd_extra", password="pass12345")
        profile = ensure_profile(user)
        form = ProfileUpdateForm(data={"bio": "ok"}, instance=profile)
        self.assertTrue(form.is_valid(), form.errors)
        form.cleaned_data = {"image": None}
        self.assertIsNone(form.clean_image())

        instance = form.save(commit=False)
        self.assertEqual(instance.pk, profile.pk)
