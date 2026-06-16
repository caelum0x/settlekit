"""Shared HTTP plumbing for the sync and async SettleKit clients.

This module centralizes the parts that are identical between the synchronous and
asynchronous clients: configuration resolution, header construction, the
``{data}`` / ``{error}`` envelope contract, and decoding of non-2xx responses
into a typed :class:`SettleKitError`.
"""

from __future__ import annotations

import json
import os
import secrets
from typing import Any, Mapping, Optional

import httpx

from .errors import SettleKitConfigError, SettleKitError

DEFAULT_BASE_URL = "http://localhost:8787"
DEFAULT_TIMEOUT = 30.0

_WRITE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


def resolve_base_url(base_url: Optional[str]) -> str:
    """Resolve the API base URL from the argument, env, or default."""
    resolved = base_url or os.environ.get("SETTLEKIT_API_URL") or DEFAULT_BASE_URL
    return resolved.rstrip("/")


def resolve_api_key(api_key: Optional[str], *, required: bool = True) -> str:
    """Resolve the API key from the argument or ``SETTLEKIT_API_KEY``.

    When ``required`` is True and no key is found a :class:`SettleKitConfigError`
    is raised. Public ``/v1/auth`` endpoints may pass ``required=False``.
    """
    resolved = api_key if api_key is not None else os.environ.get("SETTLEKIT_API_KEY")
    if required and not resolved:
        raise SettleKitConfigError(
            "Missing API key. Pass api_key= or set the SETTLEKIT_API_KEY "
            "environment variable."
        )
    return resolved or ""


def build_headers(bearer: str, has_body: bool, method: str) -> dict[str, str]:
    """Assemble request headers including auth, content-type, and idempotency."""
    headers: dict[str, str] = {"Accept": "application/json"}
    if bearer:
        headers["Authorization"] = f"Bearer {bearer}"
    if has_body:
        headers["Content-Type"] = "application/json"
    if method.upper() in _WRITE_METHODS:
        # A fresh idempotency key makes write retries safe on the server side.
        headers["Idempotency-Key"] = secrets.token_hex(16)
    return headers


def _safe_json(content: bytes) -> Any:
    try:
        return json.loads(content)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None


def decode_error(status: int, content: bytes) -> SettleKitError:
    """Map a non-2xx response body into a typed :class:`SettleKitError`."""
    payload = _safe_json(content)
    if isinstance(payload, Mapping):
        err = payload.get("error")
        if isinstance(err, Mapping):
            code = str(err.get("code") or "http_error")
            message = str(err.get("message") or httpx.codes.get_reason_phrase(status))
            details = err.get("details")
            return SettleKitError(
                code=code,
                message=message,
                status=status,
                details=details if isinstance(details, Mapping) else None,
            )
    text = content.decode("utf-8", "replace").strip()
    message = text or httpx.codes.get_reason_phrase(status) or "HTTP error"
    return SettleKitError(code="http_error", message=message, status=status)


def parse_envelope(status: int, content: bytes, *, expect_data: bool) -> Any:
    """Validate the response and unwrap the ``{data}`` envelope.

    Raises a typed :class:`SettleKitError` on any non-2xx status or malformed
    success envelope. When ``expect_data`` is False (caller ignores the body)
    the parsed payload is returned as-is without requiring a ``data`` key.
    """
    if status < 200 or status >= 300:
        raise decode_error(status, content)

    if not expect_data:
        return None

    payload = _safe_json(content)
    if not isinstance(payload, Mapping) or "data" not in payload:
        raise SettleKitError(
            code="invalid_response",
            message='Response missing "data" field',
            status=status,
        )
    return payload["data"]


def encode_body(body: Any) -> Optional[bytes]:
    """JSON-encode a request body, returning None when there is no body."""
    if body is None:
        return None
    return json.dumps(body, separators=(",", ":")).encode("utf-8")
