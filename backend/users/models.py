import uuid
from pathlib import Path

from django.db import models
from django.contrib.auth.models import User
from django.core.files.storage import default_storage
from PIL import Image


class Profile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE)
    image = models.ImageField(default="default.jpg", upload_to='profile_pics')
    last_seen = models.DateTimeField(null=True, blank=True)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Запоминаем текущий файл, чтобы удалить его после сохранения новой аватарки без доп. запросов в БД
        self._old_image_name = self.image.name

    def __str__(self):
        return f"{self.user.username} profile"

    # save method if the image is too big, Pillow for resizing

    # Alternatively, you can also resize the image before committing the form
    # Lots of ways to do it
    def save(self, *args, **kwargs):
        default_name = self._meta.get_field("image").default
        old_image_name = getattr(self, "_old_image_name", None)
        new_image_name = self.image.name if self.image else None

        # Для нового файла генерируем уникальное имя, чтобы не затирать чужие и проще чистить старый
        if new_image_name and new_image_name != old_image_name:
            ext = Path(new_image_name).suffix or ".jpg"
            self.image.name = f"{uuid.uuid4().hex}{ext}"
            new_image_name = self.image.name

        super().save(*args, **kwargs)

        # Удаляем старый файл, если он отличался от текущего и не является дефолтным
        if (
            old_image_name
            and old_image_name != new_image_name
            and old_image_name != default_name
            and default_storage.exists(old_image_name)
        ):
            default_storage.delete(old_image_name)

        try:
            img = Image.open(self.image.path)
        except (FileNotFoundError, ValueError):
            return

        if img.height > 300 or img.width > 300:
            output_size = (300, 300)
            img.thumbnail(output_size)
            img.save(self.image.path)

        # Обновим ссылку на текущий файл для последующих сохранений
        self._old_image_name = self.image.name
