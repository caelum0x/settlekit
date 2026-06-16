"""Prices resource — prices nested under a product."""

from __future__ import annotations

from typing import Any, Optional

from ._base import AsyncResource, SyncResource, clean_body


def _create_body(
    *,
    amount: str,
    interval: str,
    currency: Optional[str],
    credits_granted: Optional[int],
) -> dict[str, Any]:
    return clean_body(
        {
            "amount": amount,
            "interval": interval,
            "currency": currency,
            "creditsGranted": credits_granted,
        }
    )


class Prices(SyncResource):
    """Synchronous prices namespace."""

    def create(
        self,
        product_id: str,
        *,
        amount: str,
        interval: str = "one_time",
        currency: Optional[str] = None,
        credits_granted: Optional[int] = None,
    ) -> Any:
        """Attach a price to a product. ``POST /v1/products/:id/prices``.

        ``interval`` is one of ``"one_time"``, ``"monthly"`` or ``"yearly"``.
        """
        body = _create_body(
            amount=amount,
            interval=interval,
            currency=currency,
            credits_granted=credits_granted,
        )
        return self._request("POST", f"/v1/products/{product_id}/prices", body=body)

    def list(self, product_id: str) -> Any:
        """List prices for a product. ``GET /v1/products/:id/prices``."""
        return self._request("GET", f"/v1/products/{product_id}/prices")


class AsyncPrices(AsyncResource):
    """Asynchronous prices namespace."""

    async def create(
        self,
        product_id: str,
        *,
        amount: str,
        interval: str = "one_time",
        currency: Optional[str] = None,
        credits_granted: Optional[int] = None,
    ) -> Any:
        """Attach a price to a product. ``POST /v1/products/:id/prices``."""
        body = _create_body(
            amount=amount,
            interval=interval,
            currency=currency,
            credits_granted=credits_granted,
        )
        return await self._request(
            "POST", f"/v1/products/{product_id}/prices", body=body
        )

    async def list(self, product_id: str) -> Any:
        """List prices for a product. ``GET /v1/products/:id/prices``."""
        return await self._request("GET", f"/v1/products/{product_id}/prices")
