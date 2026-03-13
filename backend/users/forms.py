"""Forms for auth/profile workflows."""

from __future__ import annotations

import re
import warnings

from django import forms
from django.conf import settings
from django.contrib.auth import password_validation
from django.contrib.auth.models import User
from django.utils.html import strip_tags
from PIL import Image

from .identity import normalize_email
from .models import EmailIdentity, MAX_PROFILE_IMAGE_PIXELS, MAX_PROFILE_IMAGE_SIDE, Profile


USERNAME_MAX_LENGTH = max(1, min(int(getattr(settings, "USERNAME_MAX_LENGTH", 30)), 150))
USERNAME_ALLOWED_RE = re.compile(r"^[A-Za-z]+$")
USERNAME_ALLOWED_HINT = "Используйте только латинские буквы (A-Z, a-z)."


def _validate_username_symbols(username: str) -> None:
    if username and not USERNAME_ALLOWED_RE.fullmatch(username):
        raise forms.ValidationError(USERNAME_ALLOWED_HINT)


class EmailRegisterForm(forms.Form):
    email = forms.EmailField(required=True)
    password1 = forms.CharField(required=True)
    password2 = forms.CharField(required=True)

    def clean_email(self):
        email = normalize_email(self.cleaned_data.get("email"))
        if not email:
            raise forms.ValidationError("Укажите email")
        if EmailIdentity.objects.filter(email_normalized=email).exists():
            raise forms.ValidationError("Email уже используется")
        return email

    def clean(self):
        cleaned = super().clean()
        password1 = cleaned.get("password1")
        password2 = cleaned.get("password2")
        if not password1 or not password2:
            return cleaned
        if password1 != password2:
            self.add_error("password2", "Пароли не совпадают")
            return cleaned

        probe_user = User(email=cleaned.get("email", ""), username="temp")
        try:
            password_validation.validate_password(password1, user=probe_user)
        except forms.ValidationError as exc:
            self.add_error("password1", exc)
        except Exception:
            # Normalized as weak password for API layer.
            self.add_error("password1", "Пароль слишком слабый")
        return cleaned


class UserUpdateForm(forms.ModelForm):
    email = forms.EmailField(required=False)

    class Meta:
        model = User
        fields = ["username", "email"]

    def clean_username(self):
        username = (self.cleaned_data.get("username") or "").strip()
        if not username:
            return ""
        if len(username) > USERNAME_MAX_LENGTH:
            raise forms.ValidationError(f"Максимум {USERNAME_MAX_LENGTH} символов.")

        qs = User.objects.filter(username=username)
        if self.instance and self.instance.pk:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise forms.ValidationError("Имя пользователя уже занято")
        return username

    def clean_email(self):
        email = normalize_email(self.cleaned_data.get("email"))
        if not email:
            return ""
        qs = User.objects.filter(email__iexact=email)
        if self.instance and self.instance.pk:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise forms.ValidationError("Email уже используется")
        return email


class ProfileIdentityUpdateForm(forms.Form):
    name = forms.CharField(required=False, max_length=150)
    username = forms.CharField(required=False, max_length=USERNAME_MAX_LENGTH)

    def __init__(self, *args, user=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.user = user

    def clean_name(self):
        return strip_tags((self.cleaned_data.get("name") or "").strip())

    def clean_username(self):
        raw = self.cleaned_data.get("username")
        if raw is None:
            return None
        username = str(raw).strip()
        if not username:
            return None
        if len(username) > USERNAME_MAX_LENGTH:
            raise forms.ValidationError(f"Максимум {USERNAME_MAX_LENGTH} символов.")
        _validate_username_symbols(username)

        qs = Profile.objects.filter(username=username)
        user_id = getattr(self.user, "pk", None)
        if user_id is not None:
            qs = qs.exclude(user_id=user_id)
        if qs.exists():
            raise forms.ValidationError("Имя пользователя уже занято")
        return username

    def save(self, profile: Profile) -> Profile:
        cleaned = self.cleaned_data
        if "name" in cleaned:
            profile.name = cleaned.get("name") or ""
        if "username" in cleaned:
            profile.username = cleaned.get("username")
        profile.save(update_fields=["name", "username"])
        return profile


class ProfileUpdateForm(forms.ModelForm):
    class Meta:
        model = Profile
        fields = ["image", "bio"]
        widgets = {
            "bio": forms.Textarea(attrs={"rows": 4, "maxlength": 1000}),
        }

    def clean_bio(self):
        bio = self.cleaned_data.get("bio") or ""
        return strip_tags(bio).strip()

    def clean(self):
        cleaned = super().clean()
        crop_field_map = {
            "avatarCropX": "avatar_crop_x",
            "avatarCropY": "avatar_crop_y",
            "avatarCropWidth": "avatar_crop_width",
            "avatarCropHeight": "avatar_crop_height",
        }

        raw_values = {}
        for request_field in crop_field_map:
            raw = self.data.get(request_field) if hasattr(self, "data") else None
            raw_values[request_field] = str(raw).strip() if raw is not None else ""

        provided = [field for field, value in raw_values.items() if value != ""]
        if provided and len(provided) != len(crop_field_map):
            raise forms.ValidationError({"image": ["Укажите все параметры обрезки аватарки."]})

        crop_update = None
        if len(provided) == len(crop_field_map):
            parsed = {}
            try:
                for request_field, model_field in crop_field_map.items():
                    parsed[model_field] = float(raw_values[request_field])
            except (TypeError, ValueError):
                raise forms.ValidationError({"image": ["Некорректные параметры обрезки аватарки."]})

            x = parsed["avatar_crop_x"]
            y = parsed["avatar_crop_y"]
            width = parsed["avatar_crop_width"]
            height = parsed["avatar_crop_height"]

            if not (0 <= x < 1 and 0 <= y < 1 and 0 < width <= 1 and 0 < height <= 1):
                raise forms.ValidationError(
                    {"image": ["Параметры обрезки аватарки выходят за допустимые границы."]}
                )

            if (x + width) > 1.000001 or (y + height) > 1.000001:
                raise forms.ValidationError(
                    {"image": ["Параметры обрезки аватарки выходят за границы изображения."]}
                )

            crop_update = parsed
        elif cleaned.get("image"):
            crop_update = {
                "avatar_crop_x": None,
                "avatar_crop_y": None,
                "avatar_crop_width": None,
                "avatar_crop_height": None,
            }

        self._avatar_crop_update = crop_update
        return cleaned

    def clean_image(self):
        image = self.cleaned_data.get("image")
        if not image:
            return image

        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(image) as uploaded:
                    width, height = uploaded.size
                    if width > MAX_PROFILE_IMAGE_SIDE or height > MAX_PROFILE_IMAGE_SIDE:
                        raise forms.ValidationError(
                            f"Максимальный размер аватара: {MAX_PROFILE_IMAGE_SIDE}x{MAX_PROFILE_IMAGE_SIDE}."
                        )
                    if (width * height) > MAX_PROFILE_IMAGE_PIXELS:
                        raise forms.ValidationError(f"Максимум {MAX_PROFILE_IMAGE_PIXELS} пикселей.")
                    uploaded.verify()
        except forms.ValidationError:
            raise
        except (Image.DecompressionBombError, Image.DecompressionBombWarning):
            raise forms.ValidationError("Изображение слишком большое.")
        except (OSError, ValueError, Image.UnidentifiedImageError):
            raise forms.ValidationError("Некорректный формат изображения.")
        finally:
            if hasattr(image, "seek"):
                image.seek(0)

        return image

    def save(self, commit=True):
        instance = super().save(commit=False)
        crop_update = getattr(self, "_avatar_crop_update", None)
        if crop_update is not None:
            for field, value in crop_update.items():
                setattr(instance, field, value)

        if commit:
            instance.save()
            self.save_m2m()

        return instance
