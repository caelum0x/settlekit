"""License keys resource — issue and verify machine-bound license keys."""

from __future__ import annotations

from typing import Any

from ._base import AsyncResource, SyncResource


def _create_body(
    *,
    organization_id: str,
    customer_id: str,
    product_id: str,
    entitlement_id: str,
    machine_limit: int,
) -> dict[str, Any]:
    return {
        "organizationId": organization_id,
        "customerId": customer_id,
        "productId": product_id,
        "entitlementId": entitlement_id,
        "machineLimit": machine_limit,
    }


class LicenseKeys(SyncResource):
    """Synchronous license-keys namespace."""

    def create(
        self,
        *,
        organization_id: str,
        customer_id: str,
        product_id: str,
        entitlement_id: str,
        machine_limit: int,
    ) -> Any:
        """Issue a license key. ``POST /v1/license-keys``."""
        body = _create_body(
            organization_id=organization_id,
            customer_id=customer_id,
            product_id=product_id,
            entitlement_id=entitlement_id,
            machine_limit=machine_limit,
        )
        return self._request("POST", "/v1/license-keys", body=body)

    def verify(self, *, license_key: str, product_id: str, machine_id: str) -> Any:
        """Verify a license key for a machine.

        ``POST /v1/license-keys/verify`` -> ``{"active": bool, ...}``.
        """
        return self._request(
            "POST",
            "/v1/license-keys/verify",
            body={
                "licenseKey": license_key,
                "productId": product_id,
                "machineId": machine_id,
            },
        )


class AsyncLicenseKeys(AsyncResource):
    """Asynchronous license-keys namespace."""

    async def create(
        self,
        *,
        organization_id: str,
        customer_id: str,
        product_id: str,
        entitlement_id: str,
        machine_limit: int,
    ) -> Any:
        """Issue a license key. ``POST /v1/license-keys``."""
        body = _create_body(
            organization_id=organization_id,
            customer_id=customer_id,
            product_id=product_id,
            entitlement_id=entitlement_id,
            machine_limit=machine_limit,
        )
        return await self._request("POST", "/v1/license-keys", body=body)

    async def verify(
        self, *, license_key: str, product_id: str, machine_id: str
    ) -> Any:
        """Verify a license key for a machine. ``POST /v1/license-keys/verify``."""
        return await self._request(
            "POST",
            "/v1/license-keys/verify",
            body={
                "licenseKey": license_key,
                "productId": product_id,
                "machineId": machine_id,
            },
        )
