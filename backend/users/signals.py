from django.contrib.auth.models import User
from django.db import IntegrityError
from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import Profile


@receiver(post_save, sender=User)
def ensure_profile(sender, instance, **kwargs):
    if kwargs.get("raw", False):
        return
    try:
        Profile.objects.get_or_create(user=instance)
    except IntegrityError:
        # Another concurrent save may create the same one-to-one profile first.
        Profile.objects.filter(user=instance).first()
