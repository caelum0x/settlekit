"""Convenience verification helpers.

These wrap the verify endpoints with a friendlier signature: they accept an
optional client (or construct a default one from the environment), call the
relevant ``/verify`` endpoint, and return either the boolean flag or the full
result object. They are the easiest way to gate access in application code.
"""

from __future__ import annotations

import hashlib
import hmac
import time
from typing import Any, Optional, Sequence

from .client import SettleKit

__all__ = [
    "verify_license",
    "verify_api_key",
    "verify_entitlement",
    "verify_webhook_signature",
    "WEBHOOK_SIGNATURE_HEADER",
]

#: The header SettleKit sends the webhook signature in (HTTP lookup is case-insensitive).
WEBHOOK_SIGNATURE_HEADER = "SettleKit-Signature"


def verify_webhook_signature(
    secret: str,
    raw_body: str,
    signature_header: str,
    *,
    tolerance_seconds: int = 300,
    now: Optional[float] = None,
) -> bool:
    """Verify an inbound SettleKit webhook signature against the raw body.

    SettleKit signs deliveries Stripe-style: the header is
    ``t=<unix-seconds>,v1=<hex hmac-sha256("{t}.{raw_body}", secret)>``. Pass the
    EXACT raw body string you received (do not re-serialise the parsed JSON).
    Returns ``True`` only when the signature is valid and — unless
    ``tolerance_seconds`` is 0 — within the replay window.
    """
    parts: dict[str, str] = {}
    for segment in signature_header.split(","):
        key, sep, value = segment.partition("=")
        if sep:
            parts[key.strip()] = value.strip()

    t = parts.get("t")
    v1 = parts.get("v1")
    if not t or not v1:
        return False

    if tolerance_seconds > 0:
        try:
            ts = int(t)
        except ValueError:
            return False
        current = int(now if now is not None else time.time())
        if abs(current - ts) > tolerance_seconds:
            return False

    expected = hmac.new(
        secret.encode("utf-8"), f"{t}.{raw_body}".encode("utf-8"), hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, v1)


def _client(client: Optional[SettleKit]) -> tuple[SettleKit, bool]:
    """Return a usable client and whether the caller must close it."""
    if client is not None:
        return client, False
    return SettleKit(), True


def verify_license(
    license_key: str,
    product_id: str,
    machine_id: str,
    *,
    client: Optional[SettleKit] = None,
) -> bool:
    """Return True when the license key is active for this product and machine.

    ``POST /v1/license-keys/verify`` -> ``{"active": bool}``.
    """
    sk, owned = _client(client)
    try:
        result = sk.license_keys.verify(
            license_key=license_key, product_id=product_id, machine_id=machine_id
        )
        return bool(_get(result, "active"))
    finally:
        if owned:
            sk.close()


def verify_api_key(
    key: str,
    required_scopes: Sequence[str] = (),
    *,
    client: Optional[SettleKit] = None,
) -> bool:
    """Return True when the API key is valid and holds the required scopes.

    ``POST /v1/api-keys/verify`` -> ``{"valid": bool}``.
    """
    sk, owned = _client(client)
    try:
        result = sk.api_keys.verify(key=key, required_scopes=required_scopes)
        return bool(_get(result, "valid"))
    finally:
        if owned:
            sk.close()


def verify_entitlement(
    customer_id: str,
    feature: str,
    *,
    client: Optional[SettleKit] = None,
) -> bool:
    """Return True when the customer is entitled to the feature.

    ``POST /v1/entitlements/verify`` -> ``{"allowed": bool}``.
    """
    sk, owned = _client(client)
    try:
        result = sk.entitlements.verify(customer_id=customer_id, feature=feature)
        return bool(_get(result, "allowed"))
    finally:
        if owned:
            sk.close()


def _get(result: Any, key: str) -> Any:
    """Read ``key`` from a mapping-like verify result, defaulting to False."""
    if isinstance(result, dict):
        return result.get(key, False)
    return getattr(result, key, False)
