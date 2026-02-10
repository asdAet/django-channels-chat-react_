from urllib.parse import urlparse

from django.conf import settings


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


def build_profile_url(scope, image_name: str | None) -> str | None:
    if not image_name:
        return None

    if image_name.startswith("http://") or image_name.startswith("https://"):
        return image_name

    media_url = settings.MEDIA_URL or "/media/"
    if not media_url.startswith("/"):
        media_url = f"/{media_url}"
    if not media_url.endswith("/"):
        media_url = f"{media_url}/"

    path = image_name
    if not path.startswith("/"):
        path = f"{media_url}{image_name}"

    host_val = _first_value(_get_header(scope, b"x-forwarded-host"))
    scheme = _first_value(_get_header(scope, b"x-forwarded-proto"))

    origin = _first_value(_get_header(scope, b"origin"))
    if origin:
        parsed = urlparse(origin)
        if not scheme and parsed.scheme:
            scheme = parsed.scheme
        if not host_val and parsed.netloc:
            host_val = parsed.netloc

    if not host_val:
        host_val = _first_value(_get_header(scope, b"host"))

    server = scope.get("server") or (None, None)
    host_from_server, port_from_server = server

    if not host_val and host_from_server:
        host_val = host_from_server
        if ":" not in host_val and port_from_server:
            host_val = f"{host_val}:{port_from_server}"

    if not scheme:
        scheme = "https" if scope.get("scheme") in {"wss", "https"} else "http"

    if host_val:
        return f"{scheme}://{host_val}:8443{path}"

    return path
