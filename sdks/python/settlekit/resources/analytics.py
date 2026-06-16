"""Analytics resource — the merchant dashboard summary."""

from __future__ import annotations

from typing import Any, Optional
from urllib.parse import quote

from ._base import AsyncResource, SyncResource


def _summary_path(organization_id: Optional[str]) -> str:
    if organization_id:
        return f"/v1/analytics/summary?organizationId={quote(organization_id)}"
    return "/v1/analytics/summary"


class Analytics(SyncResource):
    """Synchronous analytics namespace."""

    def summary(self, *, organization_id: Optional[str] = None) -> Any:
        """Live merchant dashboard summary. ``GET /v1/analytics/summary``."""
        return self._request("GET", _summary_path(organization_id))


class AsyncAnalytics(AsyncResource):
    """Asynchronous analytics namespace."""

    async def summary(self, *, organization_id: Optional[str] = None) -> Any:
        """Live merchant dashboard summary. ``GET /v1/analytics/summary``."""
        return await self._request("GET", _summary_path(organization_id))
