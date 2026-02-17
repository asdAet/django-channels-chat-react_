"""Содержит утилиты для построения корректных публичных URL медиа."""

import hashlib
import hmac
import posixpath
import time
from ipaddress import ip_address
from urllib.parse import quote, urlencode, urlparse

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
    """Декодирует HTTP-заголовок, учитывая UTF-8 и fallback на latin-1."""
    if not value:
        return None
    try:
        return value.decode("utf-8")
    except UnicodeDecodeError:
        return value.decode("latin-1", errors="ignore")


def _get_header(scope, name: bytes) -> str | None:
    """Возвращает значение заголовка ASGI-события по имени."""
    for header, value in scope.get("headers", []):
        if header == name:
            return _decode_header(value)
    return None


def _first_value(value: str | None) -> str | None:
    """Извлекает первое значение из потенциально спискового заголовка."""
    if not value:
        return None
    return value.split(",")[0].strip()


def _normalize_scheme(value: str | None) -> str | None:
    """Нормализует схему протокола до http/https."""
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
    """Приводит базовый URL к виду scheme://host[:port] или возвращает None."""
    if not value:
        return None
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"}:
        return None
    if not parsed.netloc:
        return None
    return f"{parsed.scheme}://{parsed.netloc}"


def _base_from_host_and_scheme(host: str | None, scheme: str | None) -> str | None:
    """Собирает базовый URL из host и scheme."""
    host_value = _first_value(host)
    if not host_value:
        return None

    normalized_scheme = _normalize_scheme(_first_value(scheme)) or "http"
    return f"{normalized_scheme}://{host_value}"


def normalize_media_path(image_name: str | None) -> str | None:
    """Нормализует путь к медиа и отбрасывает traversal/пустые значения."""
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
    """Проверяет, относится ли хост к внутренней сети/локальному окружению."""
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
    """Извлекает hostname из базового URL."""
    if not base:
        return None
    parsed = urlparse(base)
    return parsed.hostname


def _should_prefer_origin(candidate_base: str | None, origin_base: str | None) -> bool:
    """Определяет, нужно ли предпочесть Origin вместо внутреннего хоста."""
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
    """Выбирает приоритетную базу URL для формирования абсолютного пути."""
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


def _coerce_media_source(image_name: str | None, trusted_hosts: set[str] | None = None) -> str | None:
    """Преобразует входное имя/URL медиа к безопасному источнику."""
    if not image_name:
        return None

    raw = image_name.strip()
    if not raw:
        return None

    if not (raw.startswith("http://") or raw.startswith("https://")):
        return raw

    parsed = urlparse(raw)
    media_candidate = normalize_media_path(parsed.path)
    hostname = (parsed.hostname or "").strip().lower()
    trusted = {host.strip().lower() for host in (trusted_hosts or set()) if host}
    if media_candidate and (_is_internal_host(hostname) or hostname in trusted):
        return media_candidate

    return raw


def _media_signing_key() -> bytes:
    """Возвращает ключ для подписи media URL."""
    key = getattr(settings, "MEDIA_SIGNING_KEY", None) or getattr(settings, "SECRET_KEY", "")
    return str(key).encode("utf-8")


def _media_signature(path: str, expires_at: int) -> str:
    """Строит HMAC-подпись для пути медиа-файла и времени истечения."""
    payload = f"{path}:{expires_at}".encode("utf-8")
    return hmac.new(_media_signing_key(), payload, hashlib.sha256).hexdigest()


def is_valid_media_signature(path: str, expires_at: int, signature: str | None) -> bool:
    """Проверяет валидность подписи для подписанного media URL."""
    normalized = normalize_media_path(path)
    if not normalized or not signature:
        return False
    expected = _media_signature(normalized, expires_at)
    return hmac.compare_digest(expected, str(signature))


def _signed_media_url_path(image_name: str | None, expires_at: int | None = None) -> str | None:
    """Строит подписанный URL-путь до медиа endpoint."""
    normalized = normalize_media_path(image_name)
    if not normalized:
        return None

    ttl_seconds = int(getattr(settings, "MEDIA_URL_TTL_SECONDS", 300))
    expiry = int(expires_at) if expires_at is not None else int(time.time()) + ttl_seconds
    signature = _media_signature(normalized, expiry)
    encoded_path = quote(normalized, safe="/")
    query = urlencode({"exp": expiry, "sig": signature})
    return f"/api/auth/media/{encoded_path}?{query}"


def build_profile_url_from_request(request, image_name: str | None) -> str | None:
    """Формирует абсолютный URL аватара с учетом HTTP-заголовков запроса."""
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

    trusted_hosts = {
        _hostname_from_base(configured_base),
        _hostname_from_base(origin_base),
        _hostname_from_base(forwarded_base),
        _hostname_from_base(host_base),
    }
    source = _coerce_media_source(image_name, trusted_hosts={h for h in trusted_hosts if h})
    if not source:
        return None

    if source.startswith("http://") or source.startswith("https://"):
        return source

    path = _signed_media_url_path(source)
    if not path:
        return None

    base = _pick_base_url(configured_base, forwarded_base, host_base, origin_base)
    if base:
        return f"{base}{path}"

    return path


def build_profile_url(scope, image_name: str | None) -> str | None:
    """Формирует абсолютный URL аватара для WebSocket ASGI scope."""
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
    trusted_hosts = {
        _hostname_from_base(configured_base),
        _hostname_from_base(origin_base),
        _hostname_from_base(forwarded_base),
        _hostname_from_base(host_base),
    }
    source = _coerce_media_source(image_name, trusted_hosts={h for h in trusted_hosts if h})
    if not source:
        return None

    if source.startswith("http://") or source.startswith("https://"):
        return source

    path = _signed_media_url_path(source)
    if not path:
        return None

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
