"""Usage resource — metering and prepaid credits."""

from __future__ import annotations

from typing import Any, Optional
from urllib.parse import quote

from ._base import AsyncResource, SyncResource, clean_body


def _meter_body(
    *,
    organization_id: str,
    customer_id: str,
    product_id: str,
    metric: str,
    quantity: int,
    period_start: Optional[str],
) -> dict[str, Any]:
    return clean_body(
        {
            "organizationId": organization_id,
            "customerId": customer_id,
            "productId": product_id,
            "metric": metric,
            "quantity": quantity,
            "periodStart": period_start,
        }
    )


def _credit_body(
    *, organization_id: str, customer_id: str, product_id: str, credits: int
) -> dict[str, Any]:
    return {
        "organizationId": organization_id,
        "customerId": customer_id,
        "productId": product_id,
        "credits": credits,
    }


def _credits_query(*, organization_id: str, customer_id: str, product_id: str) -> str:
    return (
        f"/v1/usage/credits?organizationId={quote(organization_id)}"
        f"&customerId={quote(customer_id)}&productId={quote(product_id)}"
    )


class Usage(SyncResource):
    """Synchronous usage-based billing namespace."""

    def record(
        self,
        *,
        organization_id: str,
        customer_id: str,
        product_id: str,
        metric: str,
        quantity: int = 1,
        period_start: Optional[str] = None,
    ) -> Any:
        """Record usage of a metric. ``POST /v1/usage/record``."""
        return self._request(
            "POST",
            "/v1/usage/record",
            body=_meter_body(
                organization_id=organization_id,
                customer_id=customer_id,
                product_id=product_id,
                metric=metric,
                quantity=quantity,
                period_start=period_start,
            ),
        )

    def credits(self, *, organization_id: str, customer_id: str, product_id: str) -> Any:
        """Read a prepaid balance. ``GET /v1/usage/credits``."""
        return self._request(
            "GET",
            _credits_query(
                organization_id=organization_id,
                customer_id=customer_id,
                product_id=product_id,
            ),
        )

    def grant_credits(
        self, *, organization_id: str, customer_id: str, product_id: str, credits: int
    ) -> Any:
        """Grant prepaid credits. ``POST /v1/usage/credits/grant``."""
        return self._request(
            "POST",
            "/v1/usage/credits/grant",
            body=_credit_body(
                organization_id=organization_id,
                customer_id=customer_id,
                product_id=product_id,
                credits=credits,
            ),
        )

    def consume_credits(
        self, *, organization_id: str, customer_id: str, product_id: str, credits: int = 1
    ) -> Any:
        """Consume prepaid credits. ``POST /v1/usage/credits/consume``."""
        return self._request(
            "POST",
            "/v1/usage/credits/consume",
            body=_credit_body(
                organization_id=organization_id,
                customer_id=customer_id,
                product_id=product_id,
                credits=credits,
            ),
        )


class AsyncUsage(AsyncResource):
    """Asynchronous usage-based billing namespace."""

    async def record(
        self,
        *,
        organization_id: str,
        customer_id: str,
        product_id: str,
        metric: str,
        quantity: int = 1,
        period_start: Optional[str] = None,
    ) -> Any:
        """Record usage of a metric. ``POST /v1/usage/record``."""
        return await self._request(
            "POST",
            "/v1/usage/record",
            body=_meter_body(
                organization_id=organization_id,
                customer_id=customer_id,
                product_id=product_id,
                metric=metric,
                quantity=quantity,
                period_start=period_start,
            ),
        )

    async def credits(
        self, *, organization_id: str, customer_id: str, product_id: str
    ) -> Any:
        """Read a prepaid balance. ``GET /v1/usage/credits``."""
        return await self._request(
            "GET",
            _credits_query(
                organization_id=organization_id,
                customer_id=customer_id,
                product_id=product_id,
            ),
        )

    async def grant_credits(
        self, *, organization_id: str, customer_id: str, product_id: str, credits: int
    ) -> Any:
        """Grant prepaid credits. ``POST /v1/usage/credits/grant``."""
        return await self._request(
            "POST",
            "/v1/usage/credits/grant",
            body=_credit_body(
                organization_id=organization_id,
                customer_id=customer_id,
                product_id=product_id,
                credits=credits,
            ),
        )

    async def consume_credits(
        self, *, organization_id: str, customer_id: str, product_id: str, credits: int = 1
    ) -> Any:
        """Consume prepaid credits. ``POST /v1/usage/credits/consume``."""
        return await self._request(
            "POST",
            "/v1/usage/credits/consume",
            body=_credit_body(
                organization_id=organization_id,
                customer_id=customer_id,
                product_id=product_id,
                credits=credits,
            ),
        )
