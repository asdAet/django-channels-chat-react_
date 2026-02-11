import posixpath
from ipaddress import ip_address
from urllib.parse import urlparse

from django.conf import settings

INTERNAL_HOSTNAMES = {
    "localhost",
    "backend",
    "backend-1",
    "app-backend",
    "app-backend-1",
    "nginx",
    "nginx-1",
    "app-nginx",
    "app-nginx-1",
    "0.0.0.0",
}


def _decode_header(value: bytes | None) -> str | None:
    if not value:
        return None
    try:
        return value.decode("utf-8")
    except UnicodeDecodeError:
        return value.decode("latin-1", errors="ignore")


def _get_header(scope, name: bytes) -> str | None:
    for header, value in scope.get("headers", []):
        if header == name:
            return _decode_header(value)
    return None


def _first_value(value: str | None) -> str | None:
    if not value:
        return None
    return value.split(",")[0].strip()


def _normalize_scheme(value: str | None) -> str | None:
    if not value:
        return None
    lowered = value.strip().lower()
    if lowered in {"http", "https"}:
        return lowered
    if lowered == "wss":
        return "https"
    if lowered == "ws":
        return "http"
    return None


def _normalize_base_url(value: str | None) -> str | None:
    if not value:
        return None
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"}:
        return None
    if not parsed.netloc:
        return None
    return f"{parsed.scheme}://{parsed.netloc}"


def _base_from_host_and_scheme(host: str | None, scheme: str | None) -> str | None:
    host_value = _first_value(host)
    if not host_value:
        return None

    normalized_scheme = _normalize_scheme(_first_value(scheme)) or "http"
    return f"{normalized_scheme}://{host_value}"


def normalize_media_path(image_name: str | None) -> str | None:
    if not image_name:
        return None

    media_url = settings.MEDIA_URL or "/media/"
    raw = image_name.strip()
    if raw.startswith(media_url):
        raw = raw[len(media_url):]

    raw = raw.lstrip("/")
    normalized = posixpath.normpath(raw)
    if normalized in {"", ".", ".."}:
        return None
    if normalized.startswith("../"):
        return None
    return normalized


def _is_internal_host(hostname: str | None) -> bool:
    if not hostname:
        return False

    host = hostname.strip().lower()
    if host in INTERNAL_HOSTNAMES:
        return True

    try:
        ip = ip_address(host)
    except ValueError:
        return False

    return ip.is_private or ip.is_loopback or ip.is_link_local


def _hostname_from_base(base: str | None) -> str | None:
    if not base:
        return None
    parsed = urlparse(base)
    return parsed.hostname


def _should_prefer_origin(candidate_base: str | None, origin_base: str | None) -> bool:
    if not candidate_base or not origin_base:
        return False

    candidate_host = _hostname_from_base(candidate_base)
    origin_host = _hostname_from_base(origin_base)
    if not candidate_host or not origin_host:
        return False

    return _is_internal_host(candidate_host) and not _is_internal_host(origin_host)


def _pick_base_url(
    configured_base: str | None,
    forwarded_base: str | None,
    host_base: str | None,
    origin_base: str | None,
) -> str | None:
    if configured_base:
        return configured_base

    for base in (forwarded_base, host_base):
        if not base:
            continue
        if _should_prefer_origin(base, origin_base):
            continue
        return base

    if origin_base:
        return origin_base

    return forwarded_base or host_base


def _coerce_media_source(image_name: str | None) -> str | None:
    if not image_name:
        return None

    raw = image_name.strip()
    if not raw:
        return None

    if not (raw.startswith("http://") or raw.startswith("https://")):
        return raw

    parsed = urlparse(raw)
    media_candidate = normalize_media_path(parsed.path)
    if media_candidate and _is_internal_host(parsed.hostname):
        return media_candidate

    return raw


def _media_url_path(image_name: str | None) -> str | None:
    normalized = normalize_media_path(image_name)
    if not normalized:
        return None

    media_url = settings.MEDIA_URL or "/media/"
    if not media_url.startswith("/"):
        media_url = f"/{media_url}"
    if not media_url.endswith("/"):
        media_url = f"{media_url}/"

    return f"{media_url}{normalized}"


def build_profile_url_from_request(request, image_name: str | None) -> str | None:
    source = _coerce_media_source(image_name)
    if not source:
        return None

    if source.startswith("http://") or source.startswith("https://"):
        return source

    path = _media_url_path(source)
    if not path:
        return None

    configured_base = _normalize_base_url(getattr(settings, "PUBLIC_BASE_URL", None))
    origin_base = _normalize_base_url(_first_value(request.META.get("HTTP_ORIGIN")))
    forwarded_base = _base_from_host_and_scheme(
        request.META.get("HTTP_X_FORWARDED_HOST"),
        request.META.get("HTTP_X_FORWARDED_PROTO"),
    )

    try:
        host = request.get_host()
    except Exception:
        host = ""
    host_base = None
    if host:
        scheme = "https" if request.is_secure() else "http"
        host_base = f"{scheme}://{host}"

    base = _pick_base_url(configured_base, forwarded_base, host_base, origin_base)
    if base:
        return f"{base}{path}"

    return path


def build_profile_url(scope, image_name: str | None) -> str | None:
    source = _coerce_media_source(image_name)
    if not source:
        return None

    if source.startswith("http://") or source.startswith("https://"):
        return source

    path = _media_url_path(source)
    if not path:
        return None

    configured_base = _normalize_base_url(getattr(settings, "PUBLIC_BASE_URL", None))
    origin_base = _normalize_base_url(_first_value(_get_header(scope, b"origin")))
    forwarded_base = _base_from_host_and_scheme(
        _get_header(scope, b"x-forwarded-host"),
        _get_header(scope, b"x-forwarded-proto"),
    )
    host_base = _base_from_host_and_scheme(
        _get_header(scope, b"host"),
        "https" if scope.get("scheme") in {"wss", "https"} else "http",
    )

    base = _pick_base_url(configured_base, forwarded_base, host_base, origin_base)
    if base:
        return f"{base}{path}"

    server = scope.get("server") or (None, None)
    host_from_server, port_from_server = server
    if host_from_server:
        host_value = str(host_from_server)
        if ":" not in host_value and port_from_server:
            host_value = f"{host_value}:{port_from_server}"
        scheme = "https" if scope.get("scheme") in {"wss", "https"} else "http"
        return f"{scheme}://{host_value}{path}"

    return path
