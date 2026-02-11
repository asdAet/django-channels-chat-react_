import logging
import uuid

from django.core.cache import cache
from django.db import connections
from django.db.utils import DatabaseError
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_GET

logger = logging.getLogger(__name__)


@require_GET
def live(_request):
    return JsonResponse(
        {
            "status": "ok",
            "check": "live",
            "timestamp": timezone.now().isoformat(),
        }
    )


@require_GET
def ready(_request):
    components: dict[str, str] = {}
    ok = True

    try:
        with connections["default"].cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
        components["database"] = "ok"
    except DatabaseError:
        ok = False
        components["database"] = "error"
        logger.exception("Health check failed: database is unavailable")

    cache_key = f"health:{uuid.uuid4().hex}"
    cache_value = "ok"
    try:
        cache.set(cache_key, cache_value, timeout=5)
        if cache.get(cache_key) != cache_value:
            raise RuntimeError("cache readback mismatch")
        cache.delete(cache_key)
        components["cache"] = "ok"
    except Exception:
        ok = False
        components["cache"] = "error"
        logger.exception("Health check failed: cache is unavailable")

    status_code = 200 if ok else 503
    payload = {
        "status": "ok" if ok else "error",
        "check": "ready",
        "timestamp": timezone.now().isoformat(),
        "components": components,
    }
    return JsonResponse(payload, status=status_code)
