"""Coupons resource — create, validate, and redeem discount coupons."""

from __future__ import annotations

from typing import Any, Mapping, Optional

from ._base import AsyncResource, SyncResource, clean_body


def percent_off(percent_off: float) -> dict[str, Any]:
    """Build a percent discount payload: ``{type: "percent", percentOff}``."""
    return {"type": "percent", "percentOff": percent_off}


def amount_off(amount_off: str) -> dict[str, Any]:
    """Build a fixed-amount discount payload: ``{type: "amount", amountOff}``."""
    return {"type": "amount", "amountOff": amount_off}


def free_trial_days(days: int) -> dict[str, Any]:
    """Build a free-trial discount payload: ``{type: "free-trial-days", days}``."""
    return {"type": "free-trial-days", "days": days}


def _create_body(
    *,
    code: str,
    discount: Mapping[str, Any],
    name: Optional[str],
    max_redemptions: Optional[int],
) -> dict[str, Any]:
    return clean_body(
        {
            "code": code,
            "discount": dict(discount),
            "name": name,
            "maxRedemptions": max_redemptions,
        }
    )


def _apply_body(
    *, subtotal: str, customer_id: Optional[str]
) -> dict[str, Any]:
    return clean_body({"subtotal": subtotal, "customerId": customer_id})


class Coupons(SyncResource):
    """Synchronous coupons namespace."""

    def create(
        self,
        *,
        code: str,
        discount: Mapping[str, Any],
        name: Optional[str] = None,
        max_redemptions: Optional[int] = None,
    ) -> Any:
        """Create a coupon. ``POST /v1/coupons``.

        Build ``discount`` with :func:`percent_off`, :func:`amount_off`, or
        :func:`free_trial_days`.
        """
        body = _create_body(
            code=code, discount=discount, name=name, max_redemptions=max_redemptions
        )
        return self._request("POST", "/v1/coupons", body=body)

    def list(self) -> Any:
        """List coupons. ``GET /v1/coupons``."""
        return self._request("GET", "/v1/coupons")

    def get(self, code: str) -> Any:
        """Fetch a coupon by code. ``GET /v1/coupons/:code``."""
        return self._request("GET", f"/v1/coupons/{code}")

    def validate(
        self, code: str, *, subtotal: str, customer_id: Optional[str] = None
    ) -> Any:
        """Validate a coupon against a subtotal. ``POST /v1/coupons/:code/validate``."""
        return self._request(
            "POST",
            f"/v1/coupons/{code}/validate",
            body=_apply_body(subtotal=subtotal, customer_id=customer_id),
        )

    def redeem(
        self, code: str, *, subtotal: str, customer_id: Optional[str] = None
    ) -> Any:
        """Redeem a coupon against a subtotal. ``POST /v1/coupons/:code/redeem``."""
        return self._request(
            "POST",
            f"/v1/coupons/{code}/redeem",
            body=_apply_body(subtotal=subtotal, customer_id=customer_id),
        )


class AsyncCoupons(AsyncResource):
    """Asynchronous coupons namespace."""

    async def create(
        self,
        *,
        code: str,
        discount: Mapping[str, Any],
        name: Optional[str] = None,
        max_redemptions: Optional[int] = None,
    ) -> Any:
        """Create a coupon. ``POST /v1/coupons``."""
        body = _create_body(
            code=code, discount=discount, name=name, max_redemptions=max_redemptions
        )
        return await self._request("POST", "/v1/coupons", body=body)

    async def list(self) -> Any:
        """List coupons. ``GET /v1/coupons``."""
        return await self._request("GET", "/v1/coupons")

    async def get(self, code: str) -> Any:
        """Fetch a coupon by code. ``GET /v1/coupons/:code``."""
        return await self._request("GET", f"/v1/coupons/{code}")

    async def validate(
        self, code: str, *, subtotal: str, customer_id: Optional[str] = None
    ) -> Any:
        """Validate a coupon. ``POST /v1/coupons/:code/validate``."""
        return await self._request(
            "POST",
            f"/v1/coupons/{code}/validate",
            body=_apply_body(subtotal=subtotal, customer_id=customer_id),
        )

    async def redeem(
        self, code: str, *, subtotal: str, customer_id: Optional[str] = None
    ) -> Any:
        """Redeem a coupon. ``POST /v1/coupons/:code/redeem``."""
        return await self._request(
            "POST",
            f"/v1/coupons/{code}/redeem",
            body=_apply_body(subtotal=subtotal, customer_id=customer_id),
        )
