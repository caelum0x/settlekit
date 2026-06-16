"""AI Export Pro — a runnable FastAPI SaaS gated by SettleKit.

A complete demo SaaS that sells an "AI export" feature. Access is gated behind
SettleKit **entitlements** (for subscribers) with a **prepaid-credit** fallback
(for pay-as-you-go users), enforced via the real SettleKit Python SDK and HTTP
API. See README.md for a full curl walkthrough.

Run::

    uvicorn app.main:app --reload --port 8000
"""

from __future__ import annotations

import time
import uuid
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Optional

from fastapi import Depends, FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

from settlekit.errors import (
    SettleKitConfigError,
    SettleKitConnectionError,
    SettleKitError,
)

from . import settlekit_client as sk
from .deps import AccessGrant, GateDenied, require_ai_export_access

# ---------------------------------------------------------------------------
# Product catalog (the public landing page advertises these tiers).
# ---------------------------------------------------------------------------

PLAN_TIERS: list[dict[str, Any]] = [
    {
        "id": "free",
        "name": "Free",
        "price": {"amount": "0.00", "currency": "USDC"},
        "description": "Explore the API. AI exports require credits or Pro.",
        "ai_exports": "0 included",
    },
    {
        "id": "payg",
        "name": "Pay As You Go",
        "price": {"amount": "1.00", "currency": "USDC"},
        "description": "Buy prepaid credits. 1 credit = 1 AI export.",
        "ai_exports": "metered (1 credit each)",
    },
    {
        "id": "pro",
        "name": "Pro",
        "price": {"amount": "25.00", "currency": "USDC"},
        "description": "Unlimited AI exports via the ai_export entitlement.",
        "ai_exports": "unlimited",
    },
]


# ---------------------------------------------------------------------------
# Lifespan: validate config on boot, close the SDK client on shutdown.
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Fail fast on missing config at startup; release the client at shutdown."""
    sk.get_settings()  # raises SettleKitConfigError if misconfigured
    sk.get_client()
    try:
        yield
    finally:
        await sk.close_client()


app = FastAPI(
    title="AI Export Pro",
    version="0.1.0",
    summary="Demo SaaS gating a paid feature behind SettleKit entitlements + credits.",
    lifespan=lifespan,
)


# ---------------------------------------------------------------------------
# Request / response models.
# ---------------------------------------------------------------------------


class SignupRequest(BaseModel):
    """Payload for creating a SettleKit customer."""

    email: str = Field(..., min_length=3, max_length=320)
    name: Optional[str] = Field(default=None, max_length=200)

    @field_validator("email")
    @classmethod
    def _validate_email(cls, value: str) -> str:
        """Lightweight email shape check (avoids the email-validator dependency)."""
        value = value.strip()
        if "@" not in value or value.startswith("@") or value.endswith("@"):
            raise ValueError("email must be a valid address")
        return value


class GrantCreditsRequest(BaseModel):
    """Admin payload for granting prepaid credits."""

    customer_id: str = Field(..., min_length=1)
    credits: int = Field(..., gt=0, le=1_000_000)


class ExportRequest(BaseModel):
    """Payload describing the dataset the customer wants exported."""

    dataset: str = Field(..., min_length=1, max_length=500)
    fmt: str = Field(default="csv", pattern="^(csv|json|parquet)$")


# ---------------------------------------------------------------------------
# Error handlers — map SDK/gate exceptions to clean HTTP responses.
# ---------------------------------------------------------------------------


@app.exception_handler(GateDenied)
async def _gate_denied_handler(_, exc: GateDenied) -> JSONResponse:
    """Render a denied access decision as 402/403 with an upgrade message."""
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "code": "payment_required"
                if exc.status_code == 402
                else "forbidden",
                "message": (
                    "AI export is a paid feature. You have no active "
                    f"'{exc.feature}' entitlement and no remaining prepaid "
                    "credits. Grant credits via POST /billing/grant-credits, "
                    "buy a Pay-As-You-Go pack, or upgrade to Pro for unlimited "
                    "exports."
                ),
                "customerId": exc.customer_id,
                "creditsRemaining": exc.credits_remaining,
                "upgradeUrl": "/#pricing",
            }
        },
    )


@app.exception_handler(SettleKitConfigError)
async def _config_error_handler(_, exc: SettleKitConfigError) -> JSONResponse:
    """Configuration problems are a 500 — the server, not the client, is at fault."""
    return JSONResponse(
        status_code=500,
        content={"error": {"code": "config_error", "message": exc.message}},
    )


@app.exception_handler(SettleKitConnectionError)
async def _connection_error_handler(_, exc: SettleKitConnectionError) -> JSONResponse:
    """The SettleKit API was unreachable — surface as 502 Bad Gateway."""
    return JSONResponse(
        status_code=502,
        content={
            "error": {
                "code": "upstream_unreachable",
                "message": (
                    "Could not reach the SettleKit API. Check SETTLEKIT_API_URL "
                    "and that the API is running."
                ),
            }
        },
    )


@app.exception_handler(SettleKitError)
async def _settlekit_error_handler(_, exc: SettleKitError) -> JSONResponse:
    """Map a generic SettleKit API error to a faithful HTTP response."""
    # Pass client errors (4xx) straight through; treat upstream 5xx as 502.
    status = exc.status if 400 <= exc.status < 500 else 502
    return JSONResponse(
        status_code=status,
        content={"error": {"code": exc.code, "message": exc.message}},
    )


# ---------------------------------------------------------------------------
# Routes.
# ---------------------------------------------------------------------------


@app.get("/", tags=["public"])
async def landing() -> dict[str, Any]:
    """Public landing page describing the product and its plan tiers."""
    return {
        "product": "AI Export Pro",
        "tagline": "Export AI-generated datasets, gated by SettleKit.",
        "feature": sk.get_settings().feature,
        "plans": PLAN_TIERS,
        "docs": {
            "signup": "POST /signup",
            "entitlements": "GET /me/entitlements?customer_id=",
            "aiExport": "POST /ai/export?customer_id=",
            "grantCredits": "POST /billing/grant-credits",
            "health": "GET /healthz",
        },
    }


@app.get("/healthz", tags=["public"])
async def healthz() -> dict[str, str]:
    """Liveness probe. Does not call SettleKit so it stays cheap and reliable."""
    return {"status": "ok"}


@app.post("/signup", status_code=201, tags=["accounts"])
async def signup(req: SignupRequest) -> dict[str, Any]:
    """Create a SettleKit customer for this organization."""
    settings = sk.get_settings()
    customer = await sk.get_client().customers.create(
        organization_id=settings.organization_id,
        email=req.email,
        name=req.name,
        metadata={"source": "ai-export-pro"},
    )
    customer_id = _extract_id(customer)
    return {
        "customer": customer,
        "customerId": customer_id,
        "next": f"GET /me/entitlements?customer_id={customer_id}",
    }


@app.get("/me/entitlements", tags=["accounts"])
async def my_entitlements(customer_id: str) -> dict[str, Any]:
    """Show the customer's access: entitlement status + prepaid credit balance."""
    settings = sk.get_settings()
    client = sk.get_client()

    entitlement = await client.entitlements.verify(
        customer_id=customer_id, feature=settings.feature
    )
    allowed = (
        bool(entitlement.get("allowed")) if isinstance(entitlement, dict) else False
    )

    credits_payload = await sk.get_credits(customer_id)
    credits = credits_payload.get("credits", credits_payload.get("balance", 0))

    can_export = allowed or (isinstance(credits, int) and credits > 0)
    return {
        "customerId": customer_id,
        "feature": settings.feature,
        "entitled": allowed,
        "credits": credits,
        "canExport": can_export,
        "accessVia": "entitlement"
        if allowed
        else ("credit" if can_export else "none"),
    }


@app.post("/ai/export", tags=["paid"])
async def ai_export(
    req: ExportRequest,
    grant: AccessGrant = Depends(require_ai_export_access),
) -> dict[str, Any]:
    """PAID feature: produce an AI export.

    Reaching this body means the gate (entitlement OR a freshly consumed prepaid
    credit) passed. We record the usage event for analytics/billing and return
    the export artifact. Denials are handled upstream as 402/403 by the
    :class:`GateDenied` exception handler.
    """
    # Record the metered-usage event (best-effort; export already authorized).
    usage_recorded = True
    try:
        await sk.record_usage(grant.customer_id, quantity=1)
    except SettleKitError:
        # Don't fail a paid, authorized export because analytics recording
        # hiccuped — but make the degraded state visible in the response.
        usage_recorded = False

    artifact = _build_export(req)
    return {
        "ok": True,
        "export": artifact,
        "access": {
            "via": grant.source,
            "creditsRemaining": grant.credits_remaining,
        },
        "usageRecorded": usage_recorded,
    }


@app.post("/billing/grant-credits", tags=["admin"])
async def grant_credits(req: GrantCreditsRequest) -> dict[str, Any]:
    """Admin endpoint: grant prepaid credits to a customer.

    In a real deployment this route would itself be protected (admin API key /
    role). For the demo it calls the SettleKit credit-grant API directly.
    """
    granted = await sk.grant_credits(req.customer_id, credits=req.credits)
    balance = granted.get("credits", granted.get("balance"))
    return {
        "ok": True,
        "customerId": req.customer_id,
        "granted": req.credits,
        "balance": balance,
        "raw": granted,
    }


# ---------------------------------------------------------------------------
# Helpers.
# ---------------------------------------------------------------------------


def _extract_id(payload: Any) -> Optional[str]:
    """Pull the customer id out of a SettleKit customer payload."""
    if isinstance(payload, dict):
        for key in ("id", "customerId", "customer_id"):
            value = payload.get(key)
            if value:
                return str(value)
    return None


def _build_export(req: ExportRequest) -> dict[str, Any]:
    """Produce the (demo) AI export artifact for the requested dataset."""
    export_id = f"exp_{uuid.uuid4().hex[:12]}"
    rows = [
        {"id": 1, "insight": f"Top trend in {req.dataset}", "score": 0.97},
        {"id": 2, "insight": f"Emerging signal in {req.dataset}", "score": 0.88},
        {"id": 3, "insight": f"Anomaly detected in {req.dataset}", "score": 0.71},
    ]
    return {
        "id": export_id,
        "dataset": req.dataset,
        "format": req.fmt,
        "generatedAt": int(time.time()),
        "rowCount": len(rows),
        "rows": rows,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
