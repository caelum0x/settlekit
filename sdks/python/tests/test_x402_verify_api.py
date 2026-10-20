"""Regression test: the x402 "api" verifier must call a real SettleKit
endpoint.

Before this fix, ``X402Verifier("api")`` POSTed to ``/v1/payments/observe``'s
nonexistent sibling ``/v1/x402/verify``. That route is never registered by
``apps/api`` (only ``/v1/paid`` and ``/v1/x402/{networks,research,...}`` exist),
so every call 404'd, was swallowed by the verifier's ``except SettleKitError``,
and silently returned ``False`` — meaning ANY developer using the documented
"api" mode (the only production-safe mode; "accept" trusts any proof blindly)
would have 100% of their x402 payments rejected, forever.

This test intercepts the HTTP layer so it never touches the network and
asserts the verifier now calls the endpoint that actually performs real
on-chain re-verification: ``POST /v1/payments/observe``.
"""

from __future__ import annotations

import json

import httpx
import pytest

from settlekit.x402 import PaymentProof, PaymentRequirements, X402Verifier


def _proof(**overrides) -> PaymentProof:
    base = dict(
        tx_hash="0x" + "ab" * 32,
        from_address="0x" + "11" * 20,
        amount="0.005",
        network="base",
        nonce="nonce-1",
    )
    base.update(overrides)
    return PaymentProof(**base)


def _requirements(**overrides) -> PaymentRequirements:
    base = dict(
        amount="0.005",
        network="base",
        pay_to="0x" + "22" * 20,
        resource="/research",
        nonce="nonce-1",
        asset="USDC",
    )
    base.update(overrides)
    return PaymentRequirements(**base)


@pytest.mark.asyncio
async def test_api_mode_calls_payments_observe_not_a_dead_endpoint():
    seen_requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_requests.append(request)
        # The old, broken implementation called this path; it must never be hit.
        assert request.url.path != "/v1/x402/verify"
        assert request.url.path == "/v1/payments/observe"
        body = json.loads(request.content)
        assert body == {
            "txHash": "0x" + "ab" * 32,
            "to": "0x" + "22" * 20,
            "amount": "0.005",
            "asset": "USDC",
            "network": "base",
            "from": "0x" + "11" * 20,
        }
        return httpx.Response(201, json={"data": {"payment": {"id": "pay_1"}, "deduped": False}})

    transport = httpx.MockTransport(handler)

    async def factory(*args, **kwargs):
        return httpx.AsyncClient(transport=transport)

    import settlekit.client as client_module

    original_async_client = httpx.AsyncClient

    class PatchedAsyncClient(original_async_client):
        def __init__(self, *args, **kwargs):
            kwargs["transport"] = transport
            super().__init__(*args, **kwargs)

    client_module.httpx.AsyncClient = PatchedAsyncClient
    try:
        verifier = X402Verifier("api", api_key="sk_test_123")
        ok = await verifier.verify(_proof(), _requirements())
    finally:
        client_module.httpx.AsyncClient = original_async_client

    assert ok is True
    assert len(seen_requests) == 1


@pytest.mark.asyncio
async def test_api_mode_rejects_when_observe_endpoint_errors():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            409,
            json={"error": {"code": "conflict", "message": "transaction hash already used by another payment"}},
        )

    import settlekit.client as client_module

    original_async_client = httpx.AsyncClient
    transport = httpx.MockTransport(handler)

    class PatchedAsyncClient(original_async_client):
        def __init__(self, *args, **kwargs):
            kwargs["transport"] = transport
            super().__init__(*args, **kwargs)

    client_module.httpx.AsyncClient = PatchedAsyncClient
    try:
        verifier = X402Verifier("api", api_key="sk_test_123")
        ok = await verifier.verify(_proof(), _requirements())
    finally:
        client_module.httpx.AsyncClient = original_async_client

    assert ok is False
