"""Products resource — POST/GET /v1/products and lifecycle helpers."""

from __future__ import annotations

from typing import Any, Mapping, Optional

from ._base import AsyncResource, SyncResource, clean_body


def _create_body(
    *,
    merchant_id: str,
    organization_id: str,
    name: str,
    type: str,
    delivery_mode: str,
    description: Optional[str],
    metadata: Optional[Mapping[str, Any]],
) -> dict[str, Any]:
    return clean_body(
        {
            "merchantId": merchant_id,
            "organizationId": organization_id,
            "name": name,
            "type": type,
            "deliveryMode": delivery_mode,
            "description": description,
            "metadata": metadata,
        }
    )


class Products(SyncResource):
    """Synchronous products namespace."""

    def create(
        self,
        *,
        merchant_id: str,
        organization_id: str,
        name: str,
        type: str,
        delivery_mode: str,
        description: Optional[str] = None,
        metadata: Optional[Mapping[str, Any]] = None,
    ) -> Any:
        """Create a draft product. ``POST /v1/products``."""
        body = _create_body(
            merchant_id=merchant_id,
            organization_id=organization_id,
            name=name,
            type=type,
            delivery_mode=delivery_mode,
            description=description,
            metadata=metadata,
        )
        return self._request("POST", "/v1/products", body=body)

    def list(self) -> Any:
        """List all products. ``GET /v1/products``."""
        return self._request("GET", "/v1/products")

    def get(self, product_id: str) -> Any:
        """Fetch a product by id. ``GET /v1/products/:id``."""
        return self._request("GET", f"/v1/products/{product_id}")

    def publish(self, product_id: str) -> Any:
        """Publish a product (requires an active price). ``POST /v1/products/:id/publish``."""
        return self._request("POST", f"/v1/products/{product_id}/publish")


class AsyncProducts(AsyncResource):
    """Asynchronous products namespace."""

    async def create(
        self,
        *,
        merchant_id: str,
        organization_id: str,
        name: str,
        type: str,
        delivery_mode: str,
        description: Optional[str] = None,
        metadata: Optional[Mapping[str, Any]] = None,
    ) -> Any:
        """Create a draft product. ``POST /v1/products``."""
        body = _create_body(
            merchant_id=merchant_id,
            organization_id=organization_id,
            name=name,
            type=type,
            delivery_mode=delivery_mode,
            description=description,
            metadata=metadata,
        )
        return await self._request("POST", "/v1/products", body=body)

    async def list(self) -> Any:
        """List all products. ``GET /v1/products``."""
        return await self._request("GET", "/v1/products")

    async def get(self, product_id: str) -> Any:
        """Fetch a product by id. ``GET /v1/products/:id``."""
        return await self._request("GET", f"/v1/products/{product_id}")

    async def publish(self, product_id: str) -> Any:
        """Publish a product. ``POST /v1/products/:id/publish``."""
        return await self._request("POST", f"/v1/products/{product_id}/publish")
