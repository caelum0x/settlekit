"""Entitlements resource — the hot-path access-verification endpoint."""

from __future__ import annotations

from typing import Any

from ._base import AsyncResource, SyncResource


class Entitlements(SyncResource):
    """Synchronous entitlements namespace."""

    def verify(self, *, customer_id: str, feature: str) -> Any:
        """Verify a customer's access to a feature.

        ``POST /v1/entitlements/verify`` -> ``{"allowed": bool, ...}``.
        """
        return self._request(
            "POST",
            "/v1/entitlements/verify",
            body={"customerId": customer_id, "feature": feature},
        )


class AsyncEntitlements(AsyncResource):
    """Asynchronous entitlements namespace."""

    async def verify(self, *, customer_id: str, feature: str) -> Any:
        """Verify a customer's access to a feature. ``POST /v1/entitlements/verify``."""
        return await self._request(
            "POST",
            "/v1/entitlements/verify",
            body={"customerId": customer_id, "feature": feature},
        )
