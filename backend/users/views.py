"""Template-based views for legacy users pages."""

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.shortcuts import redirect, render

from users.application import auth_service
from users.identity import ensure_profile

from .forms import EmailRegisterForm, ProfileUpdateForm, UserUpdateForm


def register(request):
    if request.method == "POST":
        form = EmailRegisterForm(request.POST)
        if form.is_valid():
            auth_service.register_with_email(
                form.cleaned_data.get("email", ""),
                form.cleaned_data.get("password1", ""),
                form.cleaned_data.get("password2", ""),
            )
            email = form.cleaned_data.get("email", "")
            messages.success(request, f"{email} has been created!")
            return redirect("login")
    else:
        form = EmailRegisterForm()

    return render(request, "users/register.html", {"form": form})


@login_required
def profile(request):
    profile_obj = ensure_profile(request.user)

    if request.method == "POST":
        u_form = UserUpdateForm(request.POST, instance=request.user)
        p_form = ProfileUpdateForm(request.POST, request.FILES, instance=profile_obj)

        if u_form.is_valid() and p_form.is_valid():
            u_form.save()
            p_form.save()
            messages.success(request, "Your account has been updated")
            return redirect("profile")
    else:
        u_form = UserUpdateForm(instance=request.user)
        p_form = ProfileUpdateForm(instance=profile_obj)

    context = {
        "u_form": u_form,
        "p_form": p_form,
    }
    return render(request, "users/profile.html", context)
