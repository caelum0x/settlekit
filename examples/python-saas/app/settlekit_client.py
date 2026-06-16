"""Thin SettleKit SDK wiring for the AI Export Pro demo.

This module owns one process-wide :class:`AsyncSettleKit` client constructed from
environment variables and exposes a couple of helpers for the credit/usage
endpoints that the SDK does not yet wrap as first-class resources. Everything
here talks to the real SettleKit HTTP API — there are no stubs.

Environment
-----------
``SETTLEKIT_API_URL``        Base URL of the SettleKit API (default
                             ``http://localhost:8787``).
``SETTLEKIT_API_KEY``        Bearer key sent on every request. **Required.**
``SETTLEKIT_ORG_ID``         Organization id customers/usage are scoped to.
                             **Required.**
``SETTLEKIT_PRODUCT_ID``     Product id recorded against metered usage. Optional
                             but recommended; defaults to ``"ai_export"``.
``AI_EXPORT_FEATURE``        Entitlement feature key checked by the paid route.
                             Defaults to ``"ai_export"``.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Optional

from settlekit import AsyncSettleKit
from settlekit.errors import SettleKitConfigError

# The metric name we meter AI exports against in SettleKit usage records.
USAGE_METRIC = "ai_export"


@dataclass(frozen=True)
class Settings:
    """Immutable, validated runtime configuration for the demo."""

    api_url: str
    api_key: str
    organization_id: str
    product_id: str
    feature: str


def _require_env(name: str) -> str:
    """Read a required environment variable or fail fast with a clear message."""
    value = os.environ.get(name)
    if not value:
        raise SettleKitConfigError(
            f"Missing required environment variable {name!r}. "
            "See the README for the full list of env vars."
        )
    return value


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Resolve and validate settings once per process."""
    return Settings(
        api_url=os.environ.get("SETTLEKIT_API_URL", "http://localhost:8787"),
        api_key=_require_env("SETTLEKIT_API_KEY"),
        organization_id=_require_env("SETTLEKIT_ORG_ID"),
        product_id=os.environ.get("SETTLEKIT_PRODUCT_ID", "ai_export"),
        feature=os.environ.get("AI_EXPORT_FEATURE", "ai_export"),
    )


# Module-level singleton client. FastAPI's lifespan (see app.main) closes it on
# shutdown. We construct it lazily so importing the module never performs I/O.
_client: Optional[AsyncSettleKit] = None


def get_client() -> AsyncSettleKit:
    """Return the process-wide async SettleKit client, constructing it on first use."""
    global _client
    if _client is None:
        settings = get_settings()
        _client = AsyncSettleKit(
            api_key=settings.api_key,
            base_url=settings.api_url,
        )
    return _client


async def close_client() -> None:
    """Close the shared client (used by the FastAPI shutdown hook)."""
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


# ---------------------------------------------------------------------------
# Credit / usage helpers.
#
# The SDK exposes typed resources for products, customers, entitlements, etc.,
# but the prepaid-credit + metered-usage endpoints are reached through the
# client's low-level ``arequest`` method. These thin wrappers keep the call
# sites in deps.py / main.py declarative while still hitting the real API.
# ---------------------------------------------------------------------------


async def get_credits(customer_id: str) -> dict[str, Any]:
    """Return the customer's current prepaid credit balance.

    ``GET /v1/usage/credits?organizationId=&customerId=`` -> ``{"credits": int, ...}``.
    """
    settings = get_settings()
    result = await get_client().arequest(
        "GET",
        "/v1/usage/credits",
        params={
            "organizationId": settings.organization_id,
            "customerId": customer_id,
        },
    )
    return _as_dict(result)


async def grant_credits(customer_id: str, credits: int) -> dict[str, Any]:
    """Grant prepaid credits to a customer (admin operation).

    ``POST /v1/usage/credits/grant {organizationId, customerId, credits}``.
    """
    settings = get_settings()
    result = await get_client().arequest(
        "POST",
        "/v1/usage/credits/grant",
        body={
            "organizationId": settings.organization_id,
            "customerId": customer_id,
            "credits": credits,
        },
    )
    return _as_dict(result)


async def consume_credits(customer_id: str, credits: int) -> dict[str, Any]:
    """Consume prepaid credits from a customer's balance.

    ``POST /v1/usage/credits/consume {organizationId, customerId, credits}``.

    The API decrements the balance atomically and rejects the call (non-2xx,
    surfaced as ``SettleKitError``) when the balance is insufficient.
    """
    settings = get_settings()
    result = await get_client().arequest(
        "POST",
        "/v1/usage/credits/consume",
        body={
            "organizationId": settings.organization_id,
            "customerId": customer_id,
            "credits": credits,
        },
    )
    return _as_dict(result)


async def record_usage(customer_id: str, quantity: int = 1) -> dict[str, Any]:
    """Record a metered-usage event for analytics/billing.

    ``POST /v1/usage/record {organizationId, customerId, productId, metric, quantity}``.
    """
    settings = get_settings()
    result = await get_client().arequest(
        "POST",
        "/v1/usage/record",
        body={
            "organizationId": settings.organization_id,
            "customerId": customer_id,
            "productId": settings.product_id,
            "metric": USAGE_METRIC,
            "quantity": quantity,
        },
    )
    return _as_dict(result)


def _as_dict(value: Any) -> dict[str, Any]:
    """Normalize an SDK payload to a plain dict for predictable downstream access."""
    if isinstance(value, dict):
        return value
    if value is None:
        return {}
    return {"data": value}
