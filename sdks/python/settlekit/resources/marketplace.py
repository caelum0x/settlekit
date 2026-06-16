"""Marketplace resource — list, search, publish, and rate marketplace listings."""

from __future__ import annotations

from typing import Any, Optional, Sequence

from ._base import AsyncResource, SyncResource, clean_params


def _create_body(
    *,
    organization_id: str,
    merchant_id: str,
    product_id: str,
    title: str,
    summary: str,
    tags: Sequence[str],
) -> dict[str, Any]:
    return {
        "organizationId": organization_id,
        "merchantId": merchant_id,
        "productId": product_id,
        "title": title,
        "summary": summary,
        "tags": list(tags),
    }


class Marketplace(SyncResource):
    """Synchronous marketplace namespace."""

    def create_listing(
        self,
        *,
        organization_id: str,
        merchant_id: str,
        product_id: str,
        title: str,
        summary: str,
        tags: Sequence[str] = (),
    ) -> Any:
        """Create a listing. ``POST /v1/marketplace/listings``."""
        return self._request(
            "POST",
            "/v1/marketplace/listings",
            body=_create_body(
                organization_id=organization_id,
                merchant_id=merchant_id,
                product_id=product_id,
                title=title,
                summary=summary,
                tags=tags,
            ),
        )

    def list_listings(
        self,
        *,
        q: Optional[str] = None,
        tag: Optional[str] = None,
        sort: Optional[str] = None,
    ) -> Any:
        """Search listings. ``GET /v1/marketplace/listings?q=&tag=&sort=top|new|price``."""
        params = clean_params({"q": q, "tag": tag, "sort": sort})
        return self._request("GET", "/v1/marketplace/listings", params=params)

    def get_listing(self, listing_id: str) -> Any:
        """Fetch a listing by id. ``GET /v1/marketplace/listings/:id``."""
        return self._request("GET", f"/v1/marketplace/listings/{listing_id}")

    def publish_listing(self, listing_id: str) -> Any:
        """Publish a listing. ``POST /v1/marketplace/listings/:id/publish``."""
        return self._request(
            "POST", f"/v1/marketplace/listings/{listing_id}/publish"
        )

    def rate_listing(self, listing_id: str, *, stars: int) -> Any:
        """Rate a listing. ``POST /v1/marketplace/listings/:id/rate``."""
        return self._request(
            "POST",
            f"/v1/marketplace/listings/{listing_id}/rate",
            body={"stars": stars},
        )

    def get_seller(self, merchant_id: str) -> Any:
        """Fetch a seller profile. ``GET /v1/marketplace/sellers/:merchantId``."""
        return self._request("GET", f"/v1/marketplace/sellers/{merchant_id}")


class AsyncMarketplace(AsyncResource):
    """Asynchronous marketplace namespace."""

    async def create_listing(
        self,
        *,
        organization_id: str,
        merchant_id: str,
        product_id: str,
        title: str,
        summary: str,
        tags: Sequence[str] = (),
    ) -> Any:
        """Create a listing. ``POST /v1/marketplace/listings``."""
        return await self._request(
            "POST",
            "/v1/marketplace/listings",
            body=_create_body(
                organization_id=organization_id,
                merchant_id=merchant_id,
                product_id=product_id,
                title=title,
                summary=summary,
                tags=tags,
            ),
        )

    async def list_listings(
        self,
        *,
        q: Optional[str] = None,
        tag: Optional[str] = None,
        sort: Optional[str] = None,
    ) -> Any:
        """Search listings. ``GET /v1/marketplace/listings``."""
        params = clean_params({"q": q, "tag": tag, "sort": sort})
        return await self._request(
            "GET", "/v1/marketplace/listings", params=params
        )

    async def get_listing(self, listing_id: str) -> Any:
        """Fetch a listing by id. ``GET /v1/marketplace/listings/:id``."""
        return await self._request(
            "GET", f"/v1/marketplace/listings/{listing_id}"
        )

    async def publish_listing(self, listing_id: str) -> Any:
        """Publish a listing. ``POST /v1/marketplace/listings/:id/publish``."""
        return await self._request(
            "POST", f"/v1/marketplace/listings/{listing_id}/publish"
        )

    async def rate_listing(self, listing_id: str, *, stars: int) -> Any:
        """Rate a listing. ``POST /v1/marketplace/listings/:id/rate``."""
        return await self._request(
            "POST",
            f"/v1/marketplace/listings/{listing_id}/rate",
            body={"stars": stars},
        )

    async def get_seller(self, merchant_id: str) -> Any:
        """Fetch a seller profile. ``GET /v1/marketplace/sellers/:merchantId``."""
        return await self._request(
            "GET", f"/v1/marketplace/sellers/{merchant_id}"
        )
