"""Invoices resource — draft, finalize, pay, and void invoices."""

from __future__ import annotations

from typing import Any, Iterable, Mapping

from ._base import AsyncResource, SyncResource, clean_body


def _normalize_line_items(
    line_items: Iterable[Mapping[str, Any]]
) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for item in line_items:
        normalized.append(
            clean_body(
                {
                    "description": item.get("description"),
                    "quantity": item.get("quantity"),
                    "unitAmount": item.get("unitAmount") or item.get("unit_amount"),
                }
            )
        )
    return normalized


class Invoices(SyncResource):
    """Synchronous invoices namespace."""

    def create(
        self,
        *,
        organization_id: str,
        customer_id: str,
        line_items: Iterable[Mapping[str, Any]],
    ) -> Any:
        """Create a draft invoice. ``POST /v1/invoices``.

        Each line item is a mapping with ``description``, ``quantity`` and
        ``unitAmount``.
        """
        body = {
            "organizationId": organization_id,
            "customerId": customer_id,
            "lineItems": _normalize_line_items(line_items),
        }
        return self._request("POST", "/v1/invoices", body=body)

    def list(self) -> Any:
        """List invoices. ``GET /v1/invoices``."""
        return self._request("GET", "/v1/invoices")

    def finalize(self, invoice_id: str) -> Any:
        """Finalize a draft invoice. ``POST /v1/invoices/:id/finalize``."""
        return self._request("POST", f"/v1/invoices/{invoice_id}/finalize")

    def pay(self, invoice_id: str) -> Any:
        """Mark an invoice paid. ``POST /v1/invoices/:id/pay``."""
        return self._request("POST", f"/v1/invoices/{invoice_id}/pay")

    def void(self, invoice_id: str) -> Any:
        """Void an invoice. ``POST /v1/invoices/:id/void``."""
        return self._request("POST", f"/v1/invoices/{invoice_id}/void")


class AsyncInvoices(AsyncResource):
    """Asynchronous invoices namespace."""

    async def create(
        self,
        *,
        organization_id: str,
        customer_id: str,
        line_items: Iterable[Mapping[str, Any]],
    ) -> Any:
        """Create a draft invoice. ``POST /v1/invoices``."""
        body = {
            "organizationId": organization_id,
            "customerId": customer_id,
            "lineItems": _normalize_line_items(line_items),
        }
        return await self._request("POST", "/v1/invoices", body=body)

    async def list(self) -> Any:
        """List invoices. ``GET /v1/invoices``."""
        return await self._request("GET", "/v1/invoices")

    async def finalize(self, invoice_id: str) -> Any:
        """Finalize a draft invoice. ``POST /v1/invoices/:id/finalize``."""
        return await self._request("POST", f"/v1/invoices/{invoice_id}/finalize")

    async def pay(self, invoice_id: str) -> Any:
        """Mark an invoice paid. ``POST /v1/invoices/:id/pay``."""
        return await self._request("POST", f"/v1/invoices/{invoice_id}/pay")

    async def void(self, invoice_id: str) -> Any:
        """Void an invoice. ``POST /v1/invoices/:id/void``."""
        return await self._request("POST", f"/v1/invoices/{invoice_id}/void")
