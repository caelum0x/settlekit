"""Base classes shared by every resource namespace.

Each resource module exposes two thin wrappers — a synchronous one and an
asynchronous one — over the parent client's ``request`` / ``arequest`` method.
The classes here capture the bound client reference so concrete resources can
stay declarative.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Mapping, Optional

if TYPE_CHECKING:  # pragma: no cover - typing only
    from ..client import AsyncSettleKit, SettleKit


def clean_params(params: Mapping[str, Any]) -> dict[str, Any]:
    """Drop ``None`` values so optional query params are omitted entirely."""
    return {k: v for k, v in params.items() if v is not None}


def clean_body(body: Mapping[str, Any]) -> dict[str, Any]:
    """Drop ``None`` values so optional fields are omitted from the JSON body."""
    return {k: v for k, v in body.items() if v is not None}


class SyncResource:
    """Base for synchronous resource namespaces."""

    def __init__(self, client: "SettleKit") -> None:
        self._client = client

    def _request(
        self,
        method: str,
        path: str,
        *,
        body: Optional[Any] = None,
        params: Optional[Mapping[str, Any]] = None,
        expect_data: bool = True,
    ) -> Any:
        return self._client.request(
            method, path, body=body, params=params, expect_data=expect_data
        )


class AsyncResource:
    """Base for asynchronous resource namespaces."""

    def __init__(self, client: "AsyncSettleKit") -> None:
        self._client = client

    async def _request(
        self,
        method: str,
        path: str,
        *,
        body: Optional[Any] = None,
        params: Optional[Mapping[str, Any]] = None,
        expect_data: bool = True,
    ) -> Any:
        return await self._client.arequest(
            method, path, body=body, params=params, expect_data=expect_data
        )
