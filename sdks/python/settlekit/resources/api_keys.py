"""API keys resource — mint scoped keys and verify them with required scopes."""

from __future__ import annotations

from typing import Any, Sequence

from ._base import AsyncResource, SyncResource


def _create_body(
    *,
    organization_id: str,
    customer_id: str,
    product_id: str,
    entitlement_id: str,
    scopes: Sequence[str],
) -> dict[str, Any]:
    return {
        "organizationId": organization_id,
        "customerId": customer_id,
        "productId": product_id,
        "entitlementId": entitlement_id,
        "scopes": list(scopes),
    }


class ApiKeys(SyncResource):
    """Synchronous api-keys namespace."""

    def create(
        self,
        *,
        organization_id: str,
        customer_id: str,
        product_id: str,
        entitlement_id: str,
        scopes: Sequence[str],
    ) -> Any:
        """Mint a scoped API key.

        ``POST /v1/api-keys`` -> ``{"apiKey": {...}, "plaintext": str}``. The
        plaintext is returned exactly once; store it securely.
        """
        body = _create_body(
            organization_id=organization_id,
            customer_id=customer_id,
            product_id=product_id,
            entitlement_id=entitlement_id,
            scopes=scopes,
        )
        return self._request("POST", "/v1/api-keys", body=body)

    def verify(self, *, key: str, required_scopes: Sequence[str] = ()) -> Any:
        """Verify a key against required scopes.

        ``POST /v1/api-keys/verify`` -> ``{"valid": bool, ...}``.
        """
        return self._request(
            "POST",
            "/v1/api-keys/verify",
            body={"key": key, "requiredScopes": list(required_scopes)},
        )


class AsyncApiKeys(AsyncResource):
    """Asynchronous api-keys namespace."""

    async def create(
        self,
        *,
        organization_id: str,
        customer_id: str,
        product_id: str,
        entitlement_id: str,
        scopes: Sequence[str],
    ) -> Any:
        """Mint a scoped API key. ``POST /v1/api-keys``."""
        body = _create_body(
            organization_id=organization_id,
            customer_id=customer_id,
            product_id=product_id,
            entitlement_id=entitlement_id,
            scopes=scopes,
        )
        return await self._request("POST", "/v1/api-keys", body=body)

    async def verify(self, *, key: str, required_scopes: Sequence[str] = ()) -> Any:
        """Verify a key against required scopes. ``POST /v1/api-keys/verify``."""
        return await self._request(
            "POST",
            "/v1/api-keys/verify",
            body={"key": key, "requiredScopes": list(required_scopes)},
        )
