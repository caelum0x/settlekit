"""Disputes resource — open, evidence, and resolve payment disputes.

A dispute is opened against a confirmed payment, evidence is submitted while it
is ``open`` / ``under_review``, and it is resolved with an outcome.
"""

from __future__ import annotations

from typing import Any, Optional

from ._base import AsyncResource, SyncResource, clean_params


def _evidence_body(*, kind: str, description: str, value: str) -> dict[str, Any]:
    return {"kind": kind, "description": description, "value": value}


class Disputes(SyncResource):
    """Synchronous disputes namespace."""

    def list(self, *, status: Optional[str] = None) -> Any:
        """List disputes, optionally filtered by status. ``GET /v1/disputes``."""
        return self._request(
            "GET", "/v1/disputes", params=clean_params({"status": status})
        )

    def open(self, *, payment_id: str, customer_id: str, reason: str) -> Any:
        """Open a dispute against a payment. ``POST /v1/disputes``.

        ``reason`` is one of: ``fraud``, ``not_received``, ``duplicate``,
        ``quality``, ``unrecognized``.
        """
        return self._request(
            "POST",
            "/v1/disputes",
            body={"paymentId": payment_id, "customerId": customer_id, "reason": reason},
        )

    def get(self, dispute_id: str) -> Any:
        """Fetch a dispute by id. ``GET /v1/disputes/:id``."""
        return self._request("GET", f"/v1/disputes/{dispute_id}")

    def submit_evidence(
        self, dispute_id: str, *, kind: str, description: str, value: str
    ) -> Any:
        """Submit a piece of evidence. ``POST /v1/disputes/:id/evidence``."""
        return self._request(
            "POST",
            f"/v1/disputes/{dispute_id}/evidence",
            body=_evidence_body(kind=kind, description=description, value=value),
        )

    def resolve(self, dispute_id: str, *, outcome: str) -> Any:
        """Resolve a dispute (``won`` / ``lost`` / ``refunded``).

        ``POST /v1/disputes/:id/resolve``.
        """
        return self._request(
            "POST", f"/v1/disputes/{dispute_id}/resolve", body={"outcome": outcome}
        )


class AsyncDisputes(AsyncResource):
    """Asynchronous disputes namespace."""

    async def list(self, *, status: Optional[str] = None) -> Any:
        """List disputes, optionally filtered by status. ``GET /v1/disputes``."""
        return await self._request(
            "GET", "/v1/disputes", params=clean_params({"status": status})
        )

    async def open(self, *, payment_id: str, customer_id: str, reason: str) -> Any:
        """Open a dispute against a payment. ``POST /v1/disputes``."""
        return await self._request(
            "POST",
            "/v1/disputes",
            body={"paymentId": payment_id, "customerId": customer_id, "reason": reason},
        )

    async def get(self, dispute_id: str) -> Any:
        """Fetch a dispute by id. ``GET /v1/disputes/:id``."""
        return await self._request("GET", f"/v1/disputes/{dispute_id}")

    async def submit_evidence(
        self, dispute_id: str, *, kind: str, description: str, value: str
    ) -> Any:
        """Submit a piece of evidence. ``POST /v1/disputes/:id/evidence``."""
        return await self._request(
            "POST",
            f"/v1/disputes/{dispute_id}/evidence",
            body=_evidence_body(kind=kind, description=description, value=value),
        )

    async def resolve(self, dispute_id: str, *, outcome: str) -> Any:
        """Resolve a dispute (``won`` / ``lost`` / ``refunded``).

        ``POST /v1/disputes/:id/resolve``.
        """
        return await self._request(
            "POST", f"/v1/disputes/{dispute_id}/resolve", body={"outcome": outcome}
        )
