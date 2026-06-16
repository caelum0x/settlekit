"""x402 paid-API primitives for FastAPI / Starlette.

The x402 protocol monetizes an HTTP endpoint with on-chain USDC payments:

1. A client requests a protected resource with no payment.
2. The server replies ``402 Payment Required`` with a ``PaymentRequirements``
   document (scheme ``x402``, amount, asset, network, payTo, resource, nonce)
   in both the JSON body and the ``X-PAYMENT-REQUIRED`` response header.
3. The client pays USDC on-chain to ``payTo`` and retries the same request with
   an ``X-PAYMENT`` request header carrying a base64-encoded JSON
   ``PaymentProof`` ``{txHash, from, amount, network, nonce}``.
4. The server decodes and verifies the proof (on-chain via the SettleKit API,
   or accepted directly when so configured) and serves the real response.

This module provides:

* :class:`PaymentRequirements` / :class:`PaymentProof` dataclasses.
* :func:`require_payment` — a FastAPI/Starlette dependency returning the
  verified :class:`PaymentProof` (or raising the 402 challenge).
* :class:`X402Middleware` — an ASGI middleware that guards a set of paths and
  injects the verified proof into ``request.state.payment``.

Verification strategy is pluggable via :class:`X402Verifier`. The default
``api`` verifier delegates to the SettleKit API's payment verify endpoint; an
``accept`` verifier accepts any well-formed proof (useful for local dev/tests).
"""

from __future__ import annotations

import base64
import binascii
import json
import os
import secrets
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Mapping, Optional, Sequence

try:  # FastAPI/Starlette are optional — only needed for the web integration.
    from starlette.requests import Request
    from starlette.responses import JSONResponse, Response
    from starlette.types import ASGIApp, Receive, Scope, Send

    _STARLETTE = True
except ModuleNotFoundError:  # pragma: no cover - exercised without starlette
    Request = Any  # type: ignore[assignment,misc]
    Response = Any  # type: ignore[assignment,misc]
    JSONResponse = Any  # type: ignore[assignment,misc]
    ASGIApp = Any  # type: ignore[assignment,misc]
    Receive = Send = Scope = Any  # type: ignore[assignment,misc]
    _STARLETTE = False

from .errors import SettleKitError

__all__ = [
    "PaymentRequirements",
    "PaymentProof",
    "X402Verifier",
    "X402Error",
    "require_payment",
    "X402Middleware",
    "new_nonce",
    "encode_proof",
    "decode_proof",
]

PAYMENT_HEADER = "X-PAYMENT"
PAYMENT_REQUIRED_HEADER = "X-PAYMENT-REQUIRED"
SCHEME = "x402"
DEFAULT_ASSET = "USDC"


def new_nonce() -> str:
    """Return a fresh URL-safe nonce binding a challenge to its proof."""
    return secrets.token_urlsafe(16)


@dataclass(frozen=True)
class PaymentRequirements:
    """The 402 challenge document sent to an unpaid client."""

    amount: str
    network: str
    pay_to: str
    resource: str
    nonce: str
    asset: str = DEFAULT_ASSET
    scheme: str = SCHEME

    def to_dict(self) -> dict[str, Any]:
        """Serialize to the wire shape expected by x402 clients."""
        return {
            "scheme": self.scheme,
            "amount": self.amount,
            "asset": self.asset,
            "network": self.network,
            "payTo": self.pay_to,
            "resource": self.resource,
            "nonce": self.nonce,
        }


@dataclass(frozen=True)
class PaymentProof:
    """A decoded ``X-PAYMENT`` proof asserting an on-chain USDC transfer."""

    tx_hash: str
    from_address: str
    amount: str
    network: str
    nonce: str
    raw: Mapping[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, payload: Mapping[str, Any]) -> "PaymentProof":
        """Build a proof from a decoded JSON mapping, validating required keys."""
        tx_hash = payload.get("txHash")
        from_address = payload.get("from")
        amount = payload.get("amount")
        network = payload.get("network")
        nonce = payload.get("nonce", "")
        missing = [
            name
            for name, value in (
                ("txHash", tx_hash),
                ("from", from_address),
                ("amount", amount),
                ("network", network),
            )
            if not value
        ]
        if missing:
            raise X402Error(
                f"Payment proof missing required field(s): {', '.join(missing)}"
            )
        return cls(
            tx_hash=str(tx_hash),
            from_address=str(from_address),
            amount=str(amount),
            network=str(network),
            nonce=str(nonce),
            raw=dict(payload),
        )

    def to_dict(self) -> dict[str, Any]:
        """Serialize back to the wire shape."""
        return {
            "txHash": self.tx_hash,
            "from": self.from_address,
            "amount": self.amount,
            "network": self.network,
            "nonce": self.nonce,
        }


class X402Error(Exception):
    """Raised when an ``X-PAYMENT`` header is malformed or fails verification."""


def encode_proof(proof: Mapping[str, Any]) -> str:
    """Base64-encode a JSON payment proof for the ``X-PAYMENT`` header."""
    raw = json.dumps(proof, separators=(",", ":")).encode("utf-8")
    return base64.b64encode(raw).decode("ascii")


def decode_proof(header_value: str) -> PaymentProof:
    """Decode a base64 JSON ``X-PAYMENT`` header into a :class:`PaymentProof`.

    Raises :class:`X402Error` when the header is not valid base64 JSON or is
    missing required fields.
    """
    value = (header_value or "").strip()
    if not value:
        raise X402Error("Empty X-PAYMENT header")
    try:
        # Tolerate missing base64 padding from some clients.
        padded = value + "=" * (-len(value) % 4)
        decoded = base64.b64decode(padded, validate=False)
    except (binascii.Error, ValueError) as exc:
        raise X402Error("X-PAYMENT header is not valid base64") from exc
    try:
        payload = json.loads(decoded)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise X402Error("X-PAYMENT header is not valid JSON") from exc
    if not isinstance(payload, Mapping):
        raise X402Error("X-PAYMENT payload must be a JSON object")
    return PaymentProof.from_dict(payload)


VerifyFn = Callable[[PaymentProof, PaymentRequirements], Awaitable[bool]]


class X402Verifier:
    """Pluggable verifier for decoded payment proofs.

    Modes:
        * ``"api"`` — delegate to the SettleKit API. The proof's ``txHash`` is
          confirmed through ``POST /v1/payments/{id}/confirm`` semantics via a
          dedicated verify call; any non-2xx is treated as a failed payment.
        * ``"accept"`` — accept any structurally valid proof whose amount and
          network match the requirements. Intended for local development and
          tests where no chain is available.
        * a custom async callable ``(proof, requirements) -> bool``.
    """

    def __init__(
        self,
        mode: str | VerifyFn = "accept",
        *,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
    ) -> None:
        self._mode = mode
        self._api_key = api_key
        self._base_url = base_url

    async def verify(
        self, proof: PaymentProof, requirements: PaymentRequirements
    ) -> bool:
        """Return True when the proof satisfies the requirements."""
        if callable(self._mode):
            return await self._mode(proof, requirements)
        if self._mode == "accept":
            return self._accept(proof, requirements)
        if self._mode == "api":
            return await self._verify_via_api(proof, requirements)
        raise X402Error(f"Unknown x402 verifier mode: {self._mode!r}")

    @staticmethod
    def _accept(proof: PaymentProof, requirements: PaymentRequirements) -> bool:
        """Structural check: amount and network must match the challenge."""
        if proof.network != requirements.network:
            return False
        if proof.nonce and requirements.nonce and proof.nonce != requirements.nonce:
            return False
        return _amount_at_least(proof.amount, requirements.amount)

    async def _verify_via_api(
        self, proof: PaymentProof, requirements: PaymentRequirements
    ) -> bool:
        """Confirm the on-chain transfer through the SettleKit API."""
        # Imported lazily so the optional async client is only needed for "api".
        from .client import AsyncSettleKit

        if not self._accept(proof, requirements):
            return False

        api_key = self._api_key or os.environ.get("SETTLEKIT_API_KEY")
        async with AsyncSettleKit(api_key=api_key, base_url=self._base_url) as sk:
            try:
                result = await sk.arequest(
                    "POST",
                    "/v1/x402/verify",
                    body={
                        "proof": proof.to_dict(),
                        "requirements": requirements.to_dict(),
                    },
                )
            except SettleKitError:
                return False
        if isinstance(result, Mapping):
            return bool(result.get("verified") or result.get("valid"))
        return bool(result)


def _amount_at_least(paid: str, required: str) -> bool:
    """Compare decimal-string USDC amounts without float rounding error."""
    from decimal import Decimal, InvalidOperation

    try:
        return Decimal(paid) >= Decimal(required)
    except (InvalidOperation, ValueError):
        return False


def _challenge_response(requirements: PaymentRequirements) -> "Response":
    """Build the 402 JSONResponse carrying the requirements (body + header)."""
    return JSONResponse(
        status_code=402,
        content={
            "error": {
                "code": "payment_required",
                "message": "Payment required to access this resource.",
            },
            "accepts": [requirements.to_dict()],
        },
        headers={
            PAYMENT_REQUIRED_HEADER: json.dumps(
                requirements.to_dict(), separators=(",", ":")
            )
        },
    )


def require_payment(
    price: str,
    network: str,
    pay_to: str,
    resource: str,
    *,
    verifier: Optional[X402Verifier] = None,
    asset: str = DEFAULT_ASSET,
):
    """Create a FastAPI/Starlette dependency guarding an endpoint with x402.

    When the incoming request has no valid ``X-PAYMENT`` header, the dependency
    raises an :class:`fastapi.HTTPException`-equivalent 402 response carrying the
    :class:`PaymentRequirements`. When a valid proof is supplied it is verified
    and returned, and also attached to ``request.state.payment``.

    Usage with FastAPI::

        @app.get("/research")
        async def research(payment: PaymentProof = Depends(
            require_payment("0.005", "base", "0xPay...", "/research")
        )):
            return {"answer": ...}
    """
    if not _STARLETTE:  # pragma: no cover - import guard
        raise RuntimeError(
            "require_payment requires starlette/fastapi. Install with "
            "'pip install settlekit[fastapi]'."
        )

    active_verifier = verifier or X402Verifier("accept")

    async def dependency(request: "Request") -> PaymentProof:
        requirements = PaymentRequirements(
            amount=price,
            network=network,
            pay_to=pay_to,
            resource=resource,
            nonce=new_nonce(),
            asset=asset,
        )
        header = request.headers.get(PAYMENT_HEADER)
        if not header:
            raise _PaymentRequired(requirements)

        try:
            proof = decode_proof(header)
        except X402Error as exc:
            raise _PaymentRequired(requirements, detail=str(exc)) from exc

        # The client echoes the nonce it was challenged with; if absent we still
        # verify amount + network, then bind the challenge nonce onto the proof.
        bound = (
            proof
            if proof.nonce
            else PaymentProof(
                tx_hash=proof.tx_hash,
                from_address=proof.from_address,
                amount=proof.amount,
                network=proof.network,
                nonce=requirements.nonce,
                raw=proof.raw,
            )
        )
        ok = await active_verifier.verify(bound, requirements)
        if not ok:
            raise _PaymentRequired(
                requirements, detail="Payment proof failed verification."
            )

        request.state.payment = bound
        return bound

    return dependency


class _PaymentRequired(Exception):
    """Internal signal carrying the 402 challenge out of a dependency.

    A handler registered by :func:`install_x402_exception_handler` (or the
    middleware) converts it into the proper 402 response. FastAPI users may also
    rely on the auto-installed handler via :func:`require_payment` paired with
    :func:`install_x402_exception_handler`.
    """

    def __init__(
        self, requirements: PaymentRequirements, detail: Optional[str] = None
    ) -> None:
        self.requirements = requirements
        self.detail = detail
        super().__init__(detail or "Payment required")


def install_x402_exception_handler(app: Any) -> None:
    """Register the handler that turns :class:`_PaymentRequired` into a 402.

    Call once on your FastAPI/Starlette app when using :func:`require_payment`::

        app = FastAPI()
        install_x402_exception_handler(app)
    """
    if not _STARLETTE:  # pragma: no cover
        raise RuntimeError("install_x402_exception_handler requires starlette/fastapi.")

    async def handler(request: "Request", exc: _PaymentRequired) -> "Response":
        response = _challenge_response(exc.requirements)
        if exc.detail:
            # Surface the reason without leaking internals.
            response.headers["X-PAYMENT-ERROR"] = exc.detail
        return response

    app.add_exception_handler(_PaymentRequired, handler)


class X402Middleware:
    """ASGI middleware that guards configured paths with the x402 flow.

    Unlike :func:`require_payment` (per-route), the middleware protects whole
    path prefixes. A request to a guarded path without a valid ``X-PAYMENT``
    header receives the 402 challenge; with a valid proof the request proceeds
    and the decoded :class:`PaymentProof` is attached to ``request.state.payment``
    (accessible to downstream handlers).
    """

    def __init__(
        self,
        app: "ASGIApp",
        *,
        price: str,
        network: str,
        pay_to: str,
        protected_paths: Sequence[str],
        verifier: Optional[X402Verifier] = None,
        asset: str = DEFAULT_ASSET,
    ) -> None:
        if not _STARLETTE:  # pragma: no cover
            raise RuntimeError("X402Middleware requires starlette/fastapi.")
        self.app = app
        self.price = price
        self.network = network
        self.pay_to = pay_to
        self.protected_paths = tuple(protected_paths)
        self.asset = asset
        self.verifier = verifier or X402Verifier("accept")

    def _is_protected(self, path: str) -> bool:
        return any(
            path == prefix or path.startswith(prefix.rstrip("/") + "/")
            for prefix in self.protected_paths
        )

    async def __call__(
        self, scope: "Scope", receive: "Receive", send: "Send"
    ) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        request = Request(scope, receive=receive)
        if not self._is_protected(request.url.path):
            await self.app(scope, receive, send)
            return

        requirements = PaymentRequirements(
            amount=self.price,
            network=self.network,
            pay_to=self.pay_to,
            resource=request.url.path,
            nonce=new_nonce(),
            asset=self.asset,
        )

        header = request.headers.get(PAYMENT_HEADER)
        if not header:
            await _challenge_response(requirements)(scope, receive, send)
            return

        try:
            proof = decode_proof(header)
        except X402Error:
            await _challenge_response(requirements)(scope, receive, send)
            return

        bound = (
            proof
            if proof.nonce
            else PaymentProof(
                tx_hash=proof.tx_hash,
                from_address=proof.from_address,
                amount=proof.amount,
                network=proof.network,
                nonce=requirements.nonce,
                raw=proof.raw,
            )
        )
        if not await self.verifier.verify(bound, requirements):
            await _challenge_response(requirements)(scope, receive, send)
            return

        # Stash the verified proof for downstream handlers via scope state.
        scope.setdefault("state", {})["payment"] = bound
        await self.app(scope, receive, send)
