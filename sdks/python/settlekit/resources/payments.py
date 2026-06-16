"""Payments resource — create, confirm, refund, and fetch payments."""

from __future__ import annotations

from typing import Any, Optional

from ._base import AsyncResource, SyncResource, clean_body


def _confirm_body(
    *, tx_hash: str, confirmations: int, min_confirmations: Optional[int]
) -> dict[str, Any]:
    return clean_body(
        {
            "txHash": tx_hash,
            "confirmations": confirmations,
            "minConfirmations": min_confirmations,
        }
    )


class Payments(SyncResource):
    """Synchronous payments namespace."""

    def create(self, *, checkout_session_id: str) -> Any:
        """Create a payment for a checkout session. ``POST /v1/payments``."""
        return self._request(
            "POST", "/v1/payments", body={"checkoutSessionId": checkout_session_id}
        )

    def confirm(
        self,
        payment_id: str,
        *,
        tx_hash: str,
        confirmations: int,
        min_confirmations: Optional[int] = None,
    ) -> Any:
        """Confirm an on-chain payment. ``POST /v1/payments/:id/confirm``."""
        body = _confirm_body(
            tx_hash=tx_hash,
            confirmations=confirmations,
            min_confirmations=min_confirmations,
        )
        return self._request("POST", f"/v1/payments/{payment_id}/confirm", body=body)

    def refund(self, payment_id: str) -> Any:
        """Refund a confirmed payment. ``POST /v1/payments/:id/refund``."""
        return self._request("POST", f"/v1/payments/{payment_id}/refund")

    def get(self, payment_id: str) -> Any:
        """Fetch a payment by id. ``GET /v1/payments/:id``."""
        return self._request("GET", f"/v1/payments/{payment_id}")


class AsyncPayments(AsyncResource):
    """Asynchronous payments namespace."""

    async def create(self, *, checkout_session_id: str) -> Any:
        """Create a payment for a checkout session. ``POST /v1/payments``."""
        return await self._request(
            "POST", "/v1/payments", body={"checkoutSessionId": checkout_session_id}
        )

    async def confirm(
        self,
        payment_id: str,
        *,
        tx_hash: str,
        confirmations: int,
        min_confirmations: Optional[int] = None,
    ) -> Any:
        """Confirm an on-chain payment. ``POST /v1/payments/:id/confirm``."""
        body = _confirm_body(
            tx_hash=tx_hash,
            confirmations=confirmations,
            min_confirmations=min_confirmations,
        )
        return await self._request(
            "POST", f"/v1/payments/{payment_id}/confirm", body=body
        )

    async def refund(self, payment_id: str) -> Any:
        """Refund a confirmed payment. ``POST /v1/payments/:id/refund``."""
        return await self._request("POST", f"/v1/payments/{payment_id}/refund")

    async def get(self, payment_id: str) -> Any:
        """Fetch a payment by id. ``GET /v1/payments/:id``."""
        return await self._request("GET", f"/v1/payments/{payment_id}")
