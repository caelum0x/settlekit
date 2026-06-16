"""FastAPI dependencies implementing the entitlement / prepaid-credit gate.

The gate enforces the AI Export Pro access policy against the **real** SettleKit
API in two steps:

1. **Entitlement check** — ask SettleKit whether the customer holds the
   ``ai_export`` feature entitlement (e.g. via an active Pro subscription). If
   so, access is unlimited and no credit is spent.
2. **Prepaid-credit fallback** — otherwise atomically consume one prepaid credit.
   If the consume call fails (no balance), access is denied.

A denied request raises :class:`GateDenied`, which the app translates into a
402/403 response carrying a friendly upgrade message. Genuine SettleKit failures
(network, 5xx, misconfiguration) propagate as :class:`SettleKitError` and are
rendered as 502/500 by the app's exception handlers — they are never silently
swallowed and never look like a billing decision.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Optional

from fastapi import Query

from settlekit.errors import SettleKitError

from . import settlekit_client as sk

# How the access was granted, surfaced in the response + logs.
GrantSource = Literal["entitlement", "credit"]


@dataclass(frozen=True)
class AccessGrant:
    """The outcome of a successful gate check passed to the route handler."""

    customer_id: str
    source: GrantSource
    # Remaining prepaid credits after the call (None when access was via
    # entitlement and no credit was consumed).
    credits_remaining: Optional[int]


class GateDenied(Exception):
    """Raised when a customer is not entitled and has no prepaid credits.

    Attributes:
        customer_id: The customer that was denied.
        status_code: 402 (payment required) when the customer exists but is out
            of credits/entitlement; 403 when access is structurally forbidden.
        feature: The feature key that was gated.
        credits_remaining: Best-effort current balance for the upgrade message.
    """

    def __init__(
        self,
        *,
        customer_id: str,
        feature: str,
        status_code: int = 402,
        credits_remaining: Optional[int] = None,
    ) -> None:
        self.customer_id = customer_id
        self.feature = feature
        self.status_code = status_code
        self.credits_remaining = credits_remaining
        super().__init__(
            f"Customer {customer_id!r} is not entitled to {feature!r} "
            "and has no prepaid credits."
        )


def _coerce_credits(payload: dict) -> Optional[int]:
    """Extract an integer credit balance from a usage payload, if present."""
    value = payload.get("credits")
    if value is None:
        value = payload.get("balance")
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


async def require_ai_export_access(
    customer_id: str = Query(
        ...,
        min_length=1,
        description="The SettleKit customer id requesting the paid feature.",
    ),
) -> AccessGrant:
    """Gate dependency for the paid AI export feature.

    Returns an :class:`AccessGrant` on success. Raises :class:`GateDenied` when
    the customer has neither the entitlement nor a spendable prepaid credit.
    """
    settings = sk.get_settings()

    # 1) Entitlement check (the hot path for subscribers).
    try:
        result = await sk.get_client().entitlements.verify(
            customer_id=customer_id,
            feature=settings.feature,
        )
    except SettleKitError as exc:
        # A 404 here means "no such entitlement record" rather than an outage.
        # Anything else (auth, 5xx, network) is a real error — re-raise so the
        # app returns 5xx instead of silently treating it as "not allowed".
        if exc.status not in (0, 404):
            raise
        result = {"allowed": False}

    allowed = bool(result.get("allowed")) if isinstance(result, dict) else False
    if allowed:
        return AccessGrant(
            customer_id=customer_id,
            source="entitlement",
            credits_remaining=None,
        )

    # 2) Prepaid-credit fallback: atomically consume one credit.
    try:
        consumed = await sk.consume_credits(customer_id, credits=1)
    except SettleKitError as exc:
        # Insufficient balance / no credit wallet -> 4xx from the API. Treat as a
        # billing denial (402). Other failures propagate as real errors.
        if exc.status and 400 <= exc.status < 500:
            balance = await _safe_balance(customer_id)
            raise GateDenied(
                customer_id=customer_id,
                feature=settings.feature,
                status_code=402,
                credits_remaining=balance,
            ) from exc
        raise

    remaining = _coerce_credits(consumed)
    return AccessGrant(
        customer_id=customer_id,
        source="credit",
        credits_remaining=remaining,
    )


async def _safe_balance(customer_id: str) -> Optional[int]:
    """Fetch the credit balance for an upgrade message; never raise."""
    try:
        payload = await sk.get_credits(customer_id)
    except SettleKitError:
        return None
    return _coerce_credits(payload)
