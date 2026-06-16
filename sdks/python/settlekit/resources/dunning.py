"""Dunning resource — recover failed subscription payments.

Start a campaign for a subscription, record attempt outcomes, and recover (or
let the schedule exhaust).
"""

from __future__ import annotations

from typing import Any, Optional

from ._base import AsyncResource, SyncResource, clean_body, clean_params


class Dunning(SyncResource):
    """Synchronous dunning namespace."""

    def list(self, *, due: bool = False) -> Any:
        """List active campaigns (or only those due). ``GET /v1/dunning``."""
        return self._request(
            "GET", "/v1/dunning", params=clean_params({"due": "true" if due else None})
        )

    def start(self, subscription_id: str) -> Any:
        """Start a dunning campaign for a subscription. ``POST /v1/dunning``."""
        return self._request(
            "POST", "/v1/dunning", body={"subscriptionId": subscription_id}
        )

    def attempt(
        self, subscription_id: str, *, outcome: str, failure_reason: Optional[str] = None
    ) -> Any:
        """Record an attempt outcome (``recovered`` / ``failed``).

        ``POST /v1/dunning/:subscriptionId/attempt``.
        """
        return self._request(
            "POST",
            f"/v1/dunning/{subscription_id}/attempt",
            body=clean_body({"outcome": outcome, "failureReason": failure_reason}),
        )

    def recover(self, subscription_id: str) -> Any:
        """Mark a campaign as recovered. ``POST /v1/dunning/:subscriptionId/recover``."""
        return self._request("POST", f"/v1/dunning/{subscription_id}/recover")


class AsyncDunning(AsyncResource):
    """Asynchronous dunning namespace."""

    async def list(self, *, due: bool = False) -> Any:
        """List active campaigns (or only those due). ``GET /v1/dunning``."""
        return await self._request(
            "GET", "/v1/dunning", params=clean_params({"due": "true" if due else None})
        )

    async def start(self, subscription_id: str) -> Any:
        """Start a dunning campaign for a subscription. ``POST /v1/dunning``."""
        return await self._request(
            "POST", "/v1/dunning", body={"subscriptionId": subscription_id}
        )

    async def attempt(
        self, subscription_id: str, *, outcome: str, failure_reason: Optional[str] = None
    ) -> Any:
        """Record an attempt outcome (``recovered`` / ``failed``).

        ``POST /v1/dunning/:subscriptionId/attempt``.
        """
        return await self._request(
            "POST",
            f"/v1/dunning/{subscription_id}/attempt",
            body=clean_body({"outcome": outcome, "failureReason": failure_reason}),
        )

    async def recover(self, subscription_id: str) -> Any:
        """Mark a campaign as recovered. ``POST /v1/dunning/:subscriptionId/recover``."""
        return await self._request("POST", f"/v1/dunning/{subscription_id}/recover")
