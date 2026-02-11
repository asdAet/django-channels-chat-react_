from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path

from . import health


def api_root(_request):
    return JsonResponse({"status": "ok"})


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/live/", health.live, name="health-live"),
    path("api/health/ready/", health.ready, name="health-ready"),
    path("api/auth/", include("users.urls")),
    path("api/chat/", include("chat.api_urls")),
    path("", api_root, name="api-root"),
]

if settings.DEBUG:
    urlpatterns += static(
        settings.MEDIA_URL,
        document_root=settings.MEDIA_ROOT,
    )
