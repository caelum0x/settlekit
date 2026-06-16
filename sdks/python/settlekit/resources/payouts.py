"""Payouts resource — create and list merchant payouts."""

from __future__ import annotations

from typing import Any

from ._base import AsyncResource, SyncResource


def _create_body(
    *, organization_id: str, wallet_address: str, amount: str, network: str
) -> dict[str, Any]:
    return {
        "organizationId": organization_id,
        "walletAddress": wallet_address,
        "amount": amount,
        "network": network,
    }


class Payouts(SyncResource):
    """Synchronous payouts namespace."""

    def create(
        self, *, organization_id: str, wallet_address: str, amount: str, network: str
    ) -> Any:
        """Create a payout. ``POST /v1/payouts``."""
        return self._request(
            "POST",
            "/v1/payouts",
            body=_create_body(
                organization_id=organization_id,
                wallet_address=wallet_address,
                amount=amount,
                network=network,
            ),
        )

    def list(self) -> Any:
        """List payouts. ``GET /v1/payouts``."""
        return self._request("GET", "/v1/payouts")


class AsyncPayouts(AsyncResource):
    """Asynchronous payouts namespace."""

    async def create(
        self, *, organization_id: str, wallet_address: str, amount: str, network: str
    ) -> Any:
        """Create a payout. ``POST /v1/payouts``."""
        return await self._request(
            "POST",
            "/v1/payouts",
            body=_create_body(
                organization_id=organization_id,
                wallet_address=wallet_address,
                amount=amount,
                network=network,
            ),
        )

    async def list(self) -> Any:
        """List payouts. ``GET /v1/payouts``."""
        return await self._request("GET", "/v1/payouts")
