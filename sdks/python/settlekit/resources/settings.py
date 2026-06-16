"""Organization settings resource — read and patch merchant dashboard config.

Reading returns defaults when unset; updating merges the provided keys over the
current values.
"""

from __future__ import annotations

from typing import Any, Optional

from ._base import AsyncResource, SyncResource, clean_body, clean_params


def _patch_body(
    *,
    organization_id: Optional[str],
    org_name: Optional[str],
    support_email: Optional[str],
    payout_currency: Optional[str],
    webhook_secret: Optional[str],
    default_rail: Optional[str],
) -> dict[str, Any]:
    return clean_body(
        {
            "organizationId": organization_id,
            "orgName": org_name,
            "supportEmail": support_email,
            "payoutCurrency": payout_currency,
            "webhookSecret": webhook_secret,
            "defaultRail": default_rail,
        }
    )


class Settings(SyncResource):
    """Synchronous organization-settings namespace."""

    def get(self, *, organization_id: Optional[str] = None) -> Any:
        """Read settings (defaults to the platform org). ``GET /v1/settings``."""
        return self._request(
            "GET", "/v1/settings", params=clean_params({"organizationId": organization_id})
        )

    def update(
        self,
        *,
        organization_id: Optional[str] = None,
        org_name: Optional[str] = None,
        support_email: Optional[str] = None,
        payout_currency: Optional[str] = None,
        webhook_secret: Optional[str] = None,
        default_rail: Optional[str] = None,
    ) -> Any:
        """Patch settings, merging provided keys. ``POST /v1/settings``."""
        return self._request(
            "POST",
            "/v1/settings",
            body=_patch_body(
                organization_id=organization_id,
                org_name=org_name,
                support_email=support_email,
                payout_currency=payout_currency,
                webhook_secret=webhook_secret,
                default_rail=default_rail,
            ),
        )


class AsyncSettings(AsyncResource):
    """Asynchronous organization-settings namespace."""

    async def get(self, *, organization_id: Optional[str] = None) -> Any:
        """Read settings (defaults to the platform org). ``GET /v1/settings``."""
        return await self._request(
            "GET", "/v1/settings", params=clean_params({"organizationId": organization_id})
        )

    async def update(
        self,
        *,
        organization_id: Optional[str] = None,
        org_name: Optional[str] = None,
        support_email: Optional[str] = None,
        payout_currency: Optional[str] = None,
        webhook_secret: Optional[str] = None,
        default_rail: Optional[str] = None,
    ) -> Any:
        """Patch settings, merging provided keys. ``POST /v1/settings``."""
        return await self._request(
            "POST",
            "/v1/settings",
            body=_patch_body(
                organization_id=organization_id,
                org_name=org_name,
                support_email=support_email,
                payout_currency=payout_currency,
                webhook_secret=webhook_secret,
                default_rail=default_rail,
            ),
        )
