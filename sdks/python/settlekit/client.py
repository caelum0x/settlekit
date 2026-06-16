"""Synchronous and asynchronous SettleKit API clients.

Both clients share the same surface: a resource namespace per domain
(``products``, ``payments``, ``coupons`` …) plus the low-level ``request`` /
``arequest`` methods used by those namespaces. The clients resolve the API key
and base URL from arguments or the ``SETTLEKIT_API_KEY`` / ``SETTLEKIT_API_URL``
environment variables, attach a Bearer token to every request, and decode the
``{data}`` / ``{error}`` envelope, raising :class:`SettleKitError` on failure.
"""

from __future__ import annotations

from types import TracebackType
from typing import Any, Mapping, Optional, Type

import httpx

from . import resources as _r
from ._transport import (
    DEFAULT_TIMEOUT,
    build_headers,
    encode_body,
    parse_envelope,
    resolve_api_key,
    resolve_base_url,
)
from .errors import SettleKitConnectionError

__all__ = ["SettleKit", "AsyncSettleKit"]


class SettleKit:
    """Synchronous SettleKit client backed by ``httpx.Client``.

    Example:
        >>> sk = SettleKit(api_key="sk_live_...")
        >>> product = sk.products.create(
        ...     merchant_id="m_1", organization_id="org_1",
        ...     name="Pro", type="digital", delivery_mode="license_key",
        ... )
        >>> sk.close()

    The client is also a context manager::

        with SettleKit() as sk:
            sk.products.list()
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        *,
        base_url: Optional[str] = None,
        timeout: float = DEFAULT_TIMEOUT,
        http_client: Optional[httpx.Client] = None,
    ) -> None:
        self.api_key = resolve_api_key(api_key)
        self.base_url = resolve_base_url(base_url)
        self._owns_client = http_client is None
        self._http = http_client or httpx.Client(timeout=timeout)

        # Resource namespaces.
        self.products = _r.Products(self)
        self.prices = _r.Prices(self)
        self.customers = _r.Customers(self)
        self.checkout = _r.CheckoutSessions(self)
        self.payments = _r.Payments(self)
        self.entitlements = _r.Entitlements(self)
        self.license_keys = _r.LicenseKeys(self)
        self.api_keys = _r.ApiKeys(self)
        self.coupons = _r.Coupons(self)
        self.invoices = _r.Invoices(self)
        self.refunds = _r.Refunds(self)
        self.subscriptions = _r.Subscriptions(self)
        self.disputes = _r.Disputes(self)
        self.dunning = _r.Dunning(self)
        self.settings = _r.Settings(self)
        self.payouts = _r.Payouts(self)
        self.agent_services = _r.AgentServices(self)
        self.marketplace = _r.Marketplace(self)
        self.usage = _r.Usage(self)
        self.analytics = _r.Analytics(self)
        self.webhooks = _r.Webhooks(self)

    def request(
        self,
        method: str,
        path: str,
        *,
        body: Optional[Any] = None,
        params: Optional[Mapping[str, Any]] = None,
        expect_data: bool = True,
    ) -> Any:
        """Perform an authenticated request and return the unwrapped payload."""
        content = encode_body(body)
        headers = build_headers(self.api_key, content is not None, method)
        try:
            response = self._http.request(
                method,
                f"{self.base_url}{path}",
                content=content,
                params=dict(params) if params else None,
                headers=headers,
            )
        except httpx.HTTPError as exc:  # pragma: no cover - network failure path
            raise SettleKitConnectionError(
                f"{method} {path}: {exc}"
            ) from exc
        return parse_envelope(
            response.status_code, response.content, expect_data=expect_data
        )

    def close(self) -> None:
        """Close the underlying HTTP client (only if this client owns it)."""
        if self._owns_client:
            self._http.close()

    def __enter__(self) -> "SettleKit":
        return self

    def __exit__(
        self,
        exc_type: Optional[Type[BaseException]],
        exc: Optional[BaseException],
        tb: Optional[TracebackType],
    ) -> None:
        self.close()


class AsyncSettleKit:
    """Asynchronous SettleKit client backed by ``httpx.AsyncClient``.

    Example:
        >>> async with AsyncSettleKit() as sk:
        ...     products = await sk.products.list()
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        *,
        base_url: Optional[str] = None,
        timeout: float = DEFAULT_TIMEOUT,
        http_client: Optional[httpx.AsyncClient] = None,
    ) -> None:
        self.api_key = resolve_api_key(api_key)
        self.base_url = resolve_base_url(base_url)
        self._owns_client = http_client is None
        self._http = http_client or httpx.AsyncClient(timeout=timeout)

        # Resource namespaces.
        self.products = _r.AsyncProducts(self)
        self.prices = _r.AsyncPrices(self)
        self.customers = _r.AsyncCustomers(self)
        self.checkout = _r.AsyncCheckoutSessions(self)
        self.payments = _r.AsyncPayments(self)
        self.entitlements = _r.AsyncEntitlements(self)
        self.license_keys = _r.AsyncLicenseKeys(self)
        self.api_keys = _r.AsyncApiKeys(self)
        self.coupons = _r.AsyncCoupons(self)
        self.invoices = _r.AsyncInvoices(self)
        self.refunds = _r.AsyncRefunds(self)
        self.subscriptions = _r.AsyncSubscriptions(self)
        self.disputes = _r.AsyncDisputes(self)
        self.dunning = _r.AsyncDunning(self)
        self.settings = _r.AsyncSettings(self)
        self.payouts = _r.AsyncPayouts(self)
        self.agent_services = _r.AsyncAgentServices(self)
        self.marketplace = _r.AsyncMarketplace(self)
        self.usage = _r.AsyncUsage(self)
        self.analytics = _r.AsyncAnalytics(self)
        self.webhooks = _r.AsyncWebhooks(self)

    async def arequest(
        self,
        method: str,
        path: str,
        *,
        body: Optional[Any] = None,
        params: Optional[Mapping[str, Any]] = None,
        expect_data: bool = True,
    ) -> Any:
        """Perform an authenticated request and return the unwrapped payload."""
        content = encode_body(body)
        headers = build_headers(self.api_key, content is not None, method)
        try:
            response = await self._http.request(
                method,
                f"{self.base_url}{path}",
                content=content,
                params=dict(params) if params else None,
                headers=headers,
            )
        except httpx.HTTPError as exc:  # pragma: no cover - network failure path
            raise SettleKitConnectionError(
                f"{method} {path}: {exc}"
            ) from exc
        return parse_envelope(
            response.status_code, response.content, expect_data=expect_data
        )

    async def aclose(self) -> None:
        """Close the underlying HTTP client (only if this client owns it)."""
        if self._owns_client:
            await self._http.aclose()

    async def __aenter__(self) -> "AsyncSettleKit":
        return self

    async def __aexit__(
        self,
        exc_type: Optional[Type[BaseException]],
        exc: Optional[BaseException],
        tb: Optional[TracebackType],
    ) -> None:
        await self.aclose()
