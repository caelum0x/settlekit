"""Webhooks resource — register delivery endpoints and emit events.

To *verify* the signature on a delivered event, use
:func:`settlekit.verify_webhook_signature` (the standalone verifier in
``settlekit.verify``) — that runs in your webhook handler, not through a client.
"""

from __future__ import annotations

from typing import Any, Mapping, Optional, Sequence

from ._base import AsyncResource, SyncResource, clean_body


def _endpoint_body(
    *, organization_id: str, url: str, enabled_events: Sequence[str]
) -> dict[str, Any]:
    return clean_body(
        {
            "organizationId": organization_id,
            "url": url,
            "enabledEvents": list(enabled_events),
        }
    )


def _event_body(
    *, organization_id: str, type: str, data: Optional[Mapping[str, Any]]
) -> dict[str, Any]:
    return clean_body(
        {
            "organizationId": organization_id,
            "type": type,
            "data": dict(data) if data is not None else {},
        }
    )


class Webhooks(SyncResource):
    """Synchronous webhooks namespace."""

    def create_endpoint(
        self,
        *,
        organization_id: str,
        url: str,
        enabled_events: Sequence[str],
    ) -> Any:
        """Register a delivery endpoint. ``POST /v1/webhooks/endpoints``.

        The response carries the ``signingSecret`` (shown once) — store it and
        pass it to :func:`settlekit.verify_webhook_signature` in your handler.
        """
        return self._request(
            "POST",
            "/v1/webhooks/endpoints",
            body=_endpoint_body(
                organization_id=organization_id, url=url, enabled_events=enabled_events
            ),
        )

    def emit(
        self,
        *,
        organization_id: str,
        type: str,
        data: Optional[Mapping[str, Any]] = None,
    ) -> Any:
        """Emit an event to matching endpoints. ``POST /v1/webhooks/events``."""
        return self._request(
            "POST",
            "/v1/webhooks/events",
            body=_event_body(organization_id=organization_id, type=type, data=data),
        )


class AsyncWebhooks(AsyncResource):
    """Asynchronous webhooks namespace."""

    async def create_endpoint(
        self,
        *,
        organization_id: str,
        url: str,
        enabled_events: Sequence[str],
    ) -> Any:
        """Register a delivery endpoint. ``POST /v1/webhooks/endpoints``."""
        return await self._request(
            "POST",
            "/v1/webhooks/endpoints",
            body=_endpoint_body(
                organization_id=organization_id, url=url, enabled_events=enabled_events
            ),
        )

    async def emit(
        self,
        *,
        organization_id: str,
        type: str,
        data: Optional[Mapping[str, Any]] = None,
    ) -> Any:
        """Emit an event to matching endpoints. ``POST /v1/webhooks/events``."""
        return await self._request(
            "POST",
            "/v1/webhooks/events",
            body=_event_body(organization_id=organization_id, type=type, data=data),
        )
