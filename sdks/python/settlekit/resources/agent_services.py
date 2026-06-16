"""Agent services resource — publish x402-priced AI services and fetch metadata."""

from __future__ import annotations

from typing import Any, Mapping

from ._base import AsyncResource, SyncResource


def _create_body(
    *,
    organization_id: str,
    merchant_id: str,
    product_id: str,
    name: str,
    description: str,
    endpoint: str,
    price: str,
    network: str,
    input_schema: Mapping[str, Any],
) -> dict[str, Any]:
    return {
        "organizationId": organization_id,
        "merchantId": merchant_id,
        "productId": product_id,
        "name": name,
        "description": description,
        "endpoint": endpoint,
        "price": price,
        "network": network,
        "inputSchema": dict(input_schema),
    }


class AgentServices(SyncResource):
    """Synchronous agent-services namespace."""

    def create(
        self,
        *,
        organization_id: str,
        merchant_id: str,
        product_id: str,
        name: str,
        description: str,
        endpoint: str,
        price: str,
        network: str,
        input_schema: Mapping[str, Any],
    ) -> Any:
        """Register an agent service. ``POST /v1/agent-services``."""
        return self._request(
            "POST",
            "/v1/agent-services",
            body=_create_body(
                organization_id=organization_id,
                merchant_id=merchant_id,
                product_id=product_id,
                name=name,
                description=description,
                endpoint=endpoint,
                price=price,
                network=network,
                input_schema=input_schema,
            ),
        )

    def list(self) -> Any:
        """List agent services. ``GET /v1/agent-services``."""
        return self._request("GET", "/v1/agent-services")

    def publish(self, service_id: str) -> Any:
        """Publish an agent service. ``POST /v1/agent-services/:id/publish``."""
        return self._request("POST", f"/v1/agent-services/{service_id}/publish")

    def metadata(self, service_id: str) -> Any:
        """Fetch machine-readable metadata. ``GET /v1/agent-services/:id/metadata.json``."""
        return self._request(
            "GET", f"/v1/agent-services/{service_id}/metadata.json"
        )


class AsyncAgentServices(AsyncResource):
    """Asynchronous agent-services namespace."""

    async def create(
        self,
        *,
        organization_id: str,
        merchant_id: str,
        product_id: str,
        name: str,
        description: str,
        endpoint: str,
        price: str,
        network: str,
        input_schema: Mapping[str, Any],
    ) -> Any:
        """Register an agent service. ``POST /v1/agent-services``."""
        return await self._request(
            "POST",
            "/v1/agent-services",
            body=_create_body(
                organization_id=organization_id,
                merchant_id=merchant_id,
                product_id=product_id,
                name=name,
                description=description,
                endpoint=endpoint,
                price=price,
                network=network,
                input_schema=input_schema,
            ),
        )

    async def list(self) -> Any:
        """List agent services. ``GET /v1/agent-services``."""
        return await self._request("GET", "/v1/agent-services")

    async def publish(self, service_id: str) -> Any:
        """Publish an agent service. ``POST /v1/agent-services/:id/publish``."""
        return await self._request(
            "POST", f"/v1/agent-services/{service_id}/publish"
        )

    async def metadata(self, service_id: str) -> Any:
        """Fetch machine-readable metadata. ``GET /v1/agent-services/:id/metadata.json``."""
        return await self._request(
            "GET", f"/v1/agent-services/{service_id}/metadata.json"
        )
