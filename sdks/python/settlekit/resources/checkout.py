"""Checkout sessions resource — POST/GET /v1/checkout-sessions."""

from __future__ import annotations

from typing import Any, Iterable, Mapping, Optional

from ._base import AsyncResource, SyncResource, clean_body


def _normalize_items(items: Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Coerce line items into the API's camelCase shape, omitting empty fields."""
    normalized: list[dict[str, Any]] = []
    for item in items:
        normalized.append(
            clean_body(
                {
                    "priceId": item.get("priceId") or item.get("price_id"),
                    "productId": item.get("productId") or item.get("product_id"),
                    "bundleId": item.get("bundleId") or item.get("bundle_id"),
                    "quantity": item.get("quantity"),
                }
            )
        )
    return normalized


def _create_body(
    *,
    organization_id: str,
    merchant_id: str,
    customer_id: Optional[str],
    items: Iterable[Mapping[str, Any]],
    pay_to_address: str,
    network: str,
    success_url: Optional[str],
    cancel_url: Optional[str],
) -> dict[str, Any]:
    return clean_body(
        {
            "organizationId": organization_id,
            "merchantId": merchant_id,
            "customerId": customer_id,
            "items": _normalize_items(items),
            "payToAddress": pay_to_address,
            "network": network,
            "successUrl": success_url,
            "cancelUrl": cancel_url,
        }
    )


class CheckoutSessions(SyncResource):
    """Synchronous checkout-sessions namespace."""

    def create(
        self,
        *,
        organization_id: str,
        merchant_id: str,
        items: Iterable[Mapping[str, Any]],
        pay_to_address: str,
        network: str,
        customer_id: Optional[str] = None,
        success_url: Optional[str] = None,
        cancel_url: Optional[str] = None,
    ) -> Any:
        """Open a checkout session. ``POST /v1/checkout-sessions``.

        ``network`` is one of ``"arc"``, ``"base"`` or ``"ethereum"``. Each item
        is a mapping with ``priceId``/``productId`` and optional ``quantity``.
        """
        body = _create_body(
            organization_id=organization_id,
            merchant_id=merchant_id,
            customer_id=customer_id,
            items=items,
            pay_to_address=pay_to_address,
            network=network,
            success_url=success_url,
            cancel_url=cancel_url,
        )
        return self._request("POST", "/v1/checkout-sessions", body=body)

    def get(self, session_id: str) -> Any:
        """Fetch a checkout session. ``GET /v1/checkout-sessions/:id``."""
        return self._request("GET", f"/v1/checkout-sessions/{session_id}")

    def cancel(self, session_id: str) -> Any:
        """Cancel an open session. ``POST /v1/checkout-sessions/:id/cancel``."""
        return self._request("POST", f"/v1/checkout-sessions/{session_id}/cancel")


class AsyncCheckoutSessions(AsyncResource):
    """Asynchronous checkout-sessions namespace."""

    async def create(
        self,
        *,
        organization_id: str,
        merchant_id: str,
        items: Iterable[Mapping[str, Any]],
        pay_to_address: str,
        network: str,
        customer_id: Optional[str] = None,
        success_url: Optional[str] = None,
        cancel_url: Optional[str] = None,
    ) -> Any:
        """Open a checkout session. ``POST /v1/checkout-sessions``."""
        body = _create_body(
            organization_id=organization_id,
            merchant_id=merchant_id,
            customer_id=customer_id,
            items=items,
            pay_to_address=pay_to_address,
            network=network,
            success_url=success_url,
            cancel_url=cancel_url,
        )
        return await self._request("POST", "/v1/checkout-sessions", body=body)

    async def get(self, session_id: str) -> Any:
        """Fetch a checkout session. ``GET /v1/checkout-sessions/:id``."""
        return await self._request("GET", f"/v1/checkout-sessions/{session_id}")

    async def cancel(self, session_id: str) -> Any:
        """Cancel an open session. ``POST /v1/checkout-sessions/:id/cancel``."""
        return await self._request(
            "POST", f"/v1/checkout-sessions/{session_id}/cancel"
        )
