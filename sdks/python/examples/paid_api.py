"""Runnable FastAPI app exposing an x402-paid endpoint and a free health route.

Run it::

    pip install "settlekit[fastapi]" uvicorn
    uvicorn examples.paid_api:app --reload --port 8000

Free route::

    curl http://localhost:8000/health
    # {"status": "ok"}

Paid route (no payment -> 402 challenge)::

    curl -i http://localhost:8000/research?q=stablecoins
    # HTTP/1.1 402 Payment Required
    # X-PAYMENT-REQUIRED: {"scheme":"x402","amount":"0.005","asset":"USDC",...}
    # {"error": {...}, "accepts": [{...}]}

Paid route (with a proof header)::

    PROOF=$(python -c 'from settlekit.x402 import encode_proof; \
        print(encode_proof({"txHash":"0xabc","from":"0xBuyer","amount":"0.005",\
        "network":"base","nonce":""}))')
    curl -H "X-PAYMENT: $PROOF" "http://localhost:8000/research?q=stablecoins"

By default this example uses the local-dev ``accept`` verifier, which accepts any
structurally valid proof whose amount >= price and network matches. Switch to the
on-chain ``api`` verifier (which confirms the transfer through the SettleKit API)
by setting ``SETTLEKIT_VERIFY_MODE=api`` and ``SETTLEKIT_API_KEY`` in the env.
"""

from __future__ import annotations

import os

from fastapi import Depends, FastAPI

from settlekit.x402 import (
    PaymentProof,
    X402Verifier,
    install_x402_exception_handler,
    require_payment,
)

# Where buyers pay. In production this is your merchant USDC address.
PAY_TO_ADDRESS = os.environ.get("SETTLEKIT_PAY_TO", "0xYourMerchantWalletAddress")
NETWORK = os.environ.get("SETTLEKIT_NETWORK", "base")
PRICE_USDC = "0.005"

# "accept" for local dev; "api" to confirm the transfer on-chain via SettleKit.
_verifier = X402Verifier(os.environ.get("SETTLEKIT_VERIFY_MODE", "accept"))

app = FastAPI(title="SettleKit x402 Paid API Example")

# Required so the 402 challenge raised inside the dependency is rendered.
install_x402_exception_handler(app)


@app.get("/health")
async def health() -> dict[str, str]:
    """Free, unauthenticated health check."""
    return {"status": "ok"}


@app.get("/research")
async def research(
    q: str = "",
    payment: PaymentProof = Depends(
        require_payment(
            price=PRICE_USDC,
            network=NETWORK,
            pay_to=PAY_TO_ADDRESS,
            resource="/research",
            verifier=_verifier,
        )
    ),
) -> dict[str, object]:
    """A paid research endpoint priced at 0.005 USDC per call.

    Reaching this body means the x402 payment proof was verified. ``payment``
    carries the on-chain transaction details for auditing/receipts.
    """
    answer = (
        f"Research summary for {q!r}: stablecoin settlement enables instant, "
        "low-fee, programmable payments for AI agents and APIs."
    )
    return {
        "query": q,
        "answer": answer,
        "paid": {
            "amount": payment.amount,
            "network": payment.network,
            "txHash": payment.tx_hash,
            "from": payment.from_address,
        },
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
