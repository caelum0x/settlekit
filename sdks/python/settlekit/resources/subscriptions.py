"""Subscriptions resource — create and manage recurring subscriptions.

Subscriptions require a recurring price (monthly/yearly). Creating one also
grants a subscription entitlement for the product; both are returned together.
"""

from __future__ import annotations

from typing import Any, Optional

from ._base import AsyncResource, SyncResource, clean_body, clean_params


def _create_body(
    *,
    organization_id: str,
    customer_id: str,
    product_id: str,
    price_id: str,
    cancel_at_period_end: Optional[bool],
) -> dict[str, Any]:
    return clean_body(
        {
            "organizationId": organization_id,
            "customerId": customer_id,
            "productId": product_id,
            "priceId": price_id,
            "cancelAtPeriodEnd": cancel_at_period_end,
        }
    )


class Subscriptions(SyncResource):
    """Synchronous subscriptions namespace."""

    def list(self, *, organization_id: Optional[str] = None) -> Any:
        """List subscriptions for an organization. ``GET /v1/subscriptions``."""
        return self._request(
            "GET",
            "/v1/subscriptions",
            params=clean_params({"organizationId": organization_id}),
        )

    def create(
        self,
        *,
        organization_id: str,
        customer_id: str,
        product_id: str,
        price_id: str,
        cancel_at_period_end: Optional[bool] = None,
    ) -> Any:
        """Create a subscription from a recurring price. ``POST /v1/subscriptions``."""
        return self._request(
            "POST",
            "/v1/subscriptions",
            body=_create_body(
                organization_id=organization_id,
                customer_id=customer_id,
                product_id=product_id,
                price_id=price_id,
                cancel_at_period_end=cancel_at_period_end,
            ),
        )

    def get(self, subscription_id: str) -> Any:
        """Fetch a subscription by id. ``GET /v1/subscriptions/:id``."""
        return self._request("GET", f"/v1/subscriptions/{subscription_id}")

    def renew(self, subscription_id: str) -> Any:
        """Advance a subscription to its next period. ``POST /v1/subscriptions/:id/renew``."""
        return self._request("POST", f"/v1/subscriptions/{subscription_id}/renew")

    def cancel(self, subscription_id: str) -> Any:
        """Cancel a subscription. ``POST /v1/subscriptions/:id/cancel``."""
        return self._request("POST", f"/v1/subscriptions/{subscription_id}/cancel")


class AsyncSubscriptions(AsyncResource):
    """Asynchronous subscriptions namespace."""

    async def list(self, *, organization_id: Optional[str] = None) -> Any:
        """List subscriptions for an organization. ``GET /v1/subscriptions``."""
        return await self._request(
            "GET",
            "/v1/subscriptions",
            params=clean_params({"organizationId": organization_id}),
        )

    async def create(
        self,
        *,
        organization_id: str,
        customer_id: str,
        product_id: str,
        price_id: str,
        cancel_at_period_end: Optional[bool] = None,
    ) -> Any:
        """Create a subscription from a recurring price. ``POST /v1/subscriptions``."""
        return await self._request(
            "POST",
            "/v1/subscriptions",
            body=_create_body(
                organization_id=organization_id,
                customer_id=customer_id,
                product_id=product_id,
                price_id=price_id,
                cancel_at_period_end=cancel_at_period_end,
            ),
        )

    async def get(self, subscription_id: str) -> Any:
        """Fetch a subscription by id. ``GET /v1/subscriptions/:id``."""
        return await self._request("GET", f"/v1/subscriptions/{subscription_id}")

    async def renew(self, subscription_id: str) -> Any:
        """Advance a subscription to its next period. ``POST /v1/subscriptions/:id/renew``."""
        return await self._request(
            "POST", f"/v1/subscriptions/{subscription_id}/renew"
        )

    async def cancel(self, subscription_id: str) -> Any:
        """Cancel a subscription. ``POST /v1/subscriptions/:id/cancel``."""
        return await self._request(
            "POST", f"/v1/subscriptions/{subscription_id}/cancel"
        )
