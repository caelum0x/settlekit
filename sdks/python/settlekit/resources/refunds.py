"""Refunds resource — create, list, and settle refunds."""

from __future__ import annotations

from typing import Any

from ._base import AsyncResource, SyncResource


def _create_body(
    *, payment_id: str, customer_id: str, amount: str, reason: str
) -> dict[str, Any]:
    return {
        "paymentId": payment_id,
        "customerId": customer_id,
        "amount": amount,
        "reason": reason,
    }


class Refunds(SyncResource):
    """Synchronous refunds namespace."""

    def create(
        self, *, payment_id: str, customer_id: str, amount: str, reason: str
    ) -> Any:
        """Create a refund. ``POST /v1/refunds``."""
        return self._request(
            "POST",
            "/v1/refunds",
            body=_create_body(
                payment_id=payment_id,
                customer_id=customer_id,
                amount=amount,
                reason=reason,
            ),
        )

    def list(self) -> Any:
        """List refunds. ``GET /v1/refunds``."""
        return self._request("GET", "/v1/refunds")

    def succeed(self, refund_id: str) -> Any:
        """Mark a refund succeeded. ``POST /v1/refunds/:id/succeed``."""
        return self._request("POST", f"/v1/refunds/{refund_id}/succeed")


class AsyncRefunds(AsyncResource):
    """Asynchronous refunds namespace."""

    async def create(
        self, *, payment_id: str, customer_id: str, amount: str, reason: str
    ) -> Any:
        """Create a refund. ``POST /v1/refunds``."""
        return await self._request(
            "POST",
            "/v1/refunds",
            body=_create_body(
                payment_id=payment_id,
                customer_id=customer_id,
                amount=amount,
                reason=reason,
            ),
        )

    async def list(self) -> Any:
        """List refunds. ``GET /v1/refunds``."""
        return await self._request("GET", "/v1/refunds")

    async def succeed(self, refund_id: str) -> Any:
        """Mark a refund succeeded. ``POST /v1/refunds/:id/succeed``."""
        return await self._request("POST", f"/v1/refunds/{refund_id}/succeed")
