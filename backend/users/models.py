import uuid
from pathlib import Path

from django.contrib.auth.models import User
from django.core.files.storage import default_storage
from django.db import models
from django.utils.html import strip_tags
from PIL import Image

MAX_PROFILE_IMAGE_SIDE = 9999999
JPEG_EXTENSIONS = {".jpg", ".jpeg"}


class Profile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE)
    image = models.ImageField(default="default.jpg", upload_to="profile_pics")
    last_seen = models.DateTimeField(null=True, blank=True)
    bio = models.TextField(blank=True, max_length=1000)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Track previous image for cleanup after avatar update.
        self._old_image_name = self.image.name

    def __str__(self):
        return f"{self.user.username} profile"

    def save(self, *args, **kwargs):
        if isinstance(self.bio, str):
            self.bio = strip_tags(self.bio).strip()

        default_name = self._meta.get_field("image").default
        old_image_name = getattr(self, "_old_image_name", None)
        new_image_name = self.image.name if self.image else None

        # Generate unique image name for new uploads.
        if new_image_name and new_image_name != old_image_name:
            ext = Path(new_image_name).suffix or ".jpg"
            self.image.name = f"{uuid.uuid4().hex}{ext}"
            new_image_name = self.image.name

        super().save(*args, **kwargs)

        if (
            old_image_name
            and old_image_name != new_image_name
            and old_image_name != default_name
            and default_storage.exists(old_image_name)
        ):
            default_storage.delete(old_image_name)

        try:
            with Image.open(self.image.path) as img:
                if img.height > MAX_PROFILE_IMAGE_SIDE or img.width > MAX_PROFILE_IMAGE_SIDE:
                    img.thumbnail((MAX_PROFILE_IMAGE_SIDE, MAX_PROFILE_IMAGE_SIDE))

                    ext = Path(self.image.name or "").suffix.lower()
                    if ext in JPEG_EXTENSIONS and img.mode not in {"RGB", "L", "CMYK", "YCbCr"}:
                        img = img.convert("RGB")

                    img.save(self.image.path)
        except (FileNotFoundError, ValueError, OSError):
            return

        self._old_image_name = self.image.name
