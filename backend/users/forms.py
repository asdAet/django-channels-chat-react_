from django import forms
from django.contrib.auth.forms import UserCreationForm
from django.contrib.auth.models import User
from django.utils.html import strip_tags

from .models import Profile


USERNAME_MAX_LENGTH = 13


class UserRegisterForm(UserCreationForm):
    class Meta:
        model = User
        fields = ["username", "password1", "password2"]

    def clean_username(self):
        username = super().clean_username().strip()
        if not username:
            return username
        if len(username) > USERNAME_MAX_LENGTH:
            raise forms.ValidationError(
                f"Максимум {USERNAME_MAX_LENGTH} символов."
            )
        return username


class UserUpdateForm(forms.ModelForm):
    email = forms.EmailField(required=False)

    class Meta:
        model = User
        fields = ["username", "email"]

    def clean_username(self):
        username = self.cleaned_data.get("username", "").strip()
        if not username:
            return username
        if len(username) > USERNAME_MAX_LENGTH:
            raise forms.ValidationError(
                f"Максимум {USERNAME_MAX_LENGTH} символов."
            )
        qs = User.objects.filter(username=username)
        if self.instance and self.instance.pk:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise forms.ValidationError("Имя пользователя уже занято")
        return username

    def clean_email(self):
        email = (self.cleaned_data.get("email") or "").strip()
        if not email:
            return ""
        qs = User.objects.filter(email__iexact=email)
        if self.instance and self.instance.pk:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise forms.ValidationError("Email уже используется")
        return email


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
