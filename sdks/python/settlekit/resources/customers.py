"""Customers resource — POST/GET /v1/customers."""

from __future__ import annotations

from typing import Any, Mapping, Optional

from ._base import AsyncResource, SyncResource, clean_body


def _create_body(
    *,
    organization_id: str,
    email: str,
    name: Optional[str],
    github_username: Optional[str],
    wallet_address: Optional[str],
    metadata: Optional[Mapping[str, Any]],
) -> dict[str, Any]:
    return clean_body(
        {
            "organizationId": organization_id,
            "email": email,
            "name": name,
            "githubUsername": github_username,
            "walletAddress": wallet_address,
            "metadata": metadata,
        }
    )


class Customers(SyncResource):
    """Synchronous customers namespace."""

    def create(
        self,
        *,
        organization_id: str,
        email: str,
        name: Optional[str] = None,
        github_username: Optional[str] = None,
        wallet_address: Optional[str] = None,
        metadata: Optional[Mapping[str, Any]] = None,
    ) -> Any:
        """Create a customer. ``POST /v1/customers``."""
        body = _create_body(
            organization_id=organization_id,
            email=email,
            name=name,
            github_username=github_username,
            wallet_address=wallet_address,
            metadata=metadata,
        )
        return self._request("POST", "/v1/customers", body=body)

    def list(self) -> Any:
        """List all customers. ``GET /v1/customers``."""
        return self._request("GET", "/v1/customers")

    def get(self, customer_id: str) -> Any:
        """Fetch a customer by id. ``GET /v1/customers/:id``."""
        return self._request("GET", f"/v1/customers/{customer_id}")


class AsyncCustomers(AsyncResource):
    """Asynchronous customers namespace."""

    async def create(
        self,
        *,
        organization_id: str,
        email: str,
        name: Optional[str] = None,
        github_username: Optional[str] = None,
        wallet_address: Optional[str] = None,
        metadata: Optional[Mapping[str, Any]] = None,
    ) -> Any:
        """Create a customer. ``POST /v1/customers``."""
        body = _create_body(
            organization_id=organization_id,
            email=email,
            name=name,
            github_username=github_username,
            wallet_address=wallet_address,
            metadata=metadata,
        )
        return await self._request("POST", "/v1/customers", body=body)

    async def list(self) -> Any:
        """List all customers. ``GET /v1/customers``."""
        return await self._request("GET", "/v1/customers")

    async def get(self, customer_id: str) -> Any:
        """Fetch a customer by id. ``GET /v1/customers/:id``."""
        return await self._request("GET", f"/v1/customers/{customer_id}")
