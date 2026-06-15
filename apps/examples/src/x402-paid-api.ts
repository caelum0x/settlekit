/**
 * Example: an x402 "pay-per-call" API.
 *
 * Exercises @settlekit/x402 `withSettleKitPayment` against the real web
 * Fetch API (Request / Response). It demonstrates the full protocol flow:
 *
 *   1. Unpaid request           -> HTTP 402 with X-Payment-Required.
 *   2. Read the challenge nonce, build a proof, encode the X-Payment header.
 *   3. Paid request             -> HTTP 200 with the protected payload.
 *
 * The on-chain verifier is supplied by the host (here a deterministic checker
 * that confirms the proof matches the advertised requirements + nonce, exactly
 * the contract a real @settlekit/arc / @settlekit/circle verifier satisfies).
 */
import {
  withSettleKitPayment,
  encodePaymentHeader,
  PAYMENT_HEADER,
  PAYMENT_REQUIRED_HEADER,
  HTTP_PAYMENT_REQUIRED,
} from "@settlekit/x402";
import type {
  PaymentProof,
  PaymentRequirements,
  PaymentVerifier,
} from "@settlekit/x402";

const PRICE = "0.005";
const NETWORK = "arc" as const;
const PAY_TO = "0x000000000000000000000000000000000000dEaD";
const PRODUCT_ID = "prod_x402_example";
const RESOURCE = "https://api.example.com/v1/insights";

export interface X402Result {
  challengeStatus: number;
  challengeAmount: string;
  paidStatus: number;
  paidBody: unknown;
  meteredCalls: number;
}

/**
 * Host verifier: confirms the proof pays at least the required amount, on the
 * required network, echoing the challenge nonce. A real deployment would call
 * an on-chain indexer here instead of comparing fields.
 */
function makeVerifier(): PaymentVerifier {
  return async (proof: PaymentProof, req: PaymentRequirements) => {
    if (proof.network !== req.network) {
      return { ok: false, reason: "wrong_network" };
    }
    if (proof.nonce !== req.nonce) {
      return { ok: false, reason: "nonce_mismatch" };
    }
    if (Number(proof.amount) < Number(req.amount)) {
      return { ok: false, reason: "underpaid" };
    }
    return { ok: true };
  };
}

export async function main(): Promise<X402Result> {
  let meteredCalls = 0;

  // The protected handler: real working logic behind the paywall.
  const paid = withSettleKitPayment({
    price: PRICE,
    currency: "USDC",
    productId: PRODUCT_ID,
    network: NETWORK,
    payTo: PAY_TO,
    resource: RESOURCE,
    // Pin a stable nonce so the challenge nonce round-trips to the verifier
    // (stateless x402: the same nonce is advertised and later verified).
    nonce: "x402-insights-v1",
    verify: makeVerifier(),
    settleAndMeter: () => {
      meteredCalls += 1;
    },
  })(async (request: Request) => {
    const url = new URL(request.url);
    return Response.json({
      insight: "USDC volume up 12% week-over-week",
      query: url.searchParams.get("q") ?? "default",
      servedAt: new Date().toISOString(),
    });
  });

  // 1. Unpaid request -> 402 challenge.
  const challenge = await paid(new Request(RESOURCE));
  if (challenge.status !== HTTP_PAYMENT_REQUIRED) {
    throw new Error(`expected 402, got ${challenge.status}`);
  }
  const requirements = JSON.parse(
    challenge.headers.get(PAYMENT_REQUIRED_HEADER) ?? "{}",
  ) as PaymentRequirements;
  if (!requirements.nonce) {
    throw new Error("challenge missing nonce");
  }

  // 2. Build a proof of payment and encode the X-Payment header.
  const proof: PaymentProof = {
    txHash: `0x${"f3".repeat(32)}`,
    from: "0x00000000000000000000000000000000000B0b00",
    amount: requirements.amount,
    network: requirements.network,
    nonce: requirements.nonce,
  };
  const paidRequest = new Request(RESOURCE, {
    headers: { [PAYMENT_HEADER]: encodePaymentHeader(proof) },
  });

  // 3. Paid request -> 200 with the protected payload.
  const paidResponse = await paid(paidRequest);
  if (paidResponse.status !== 200) {
    const text = await paidResponse.text();
    throw new Error(`expected 200 after payment, got ${paidResponse.status}: ${text}`);
  }
  const paidBody = await paidResponse.json();

  if (meteredCalls !== 1) {
    throw new Error(`expected exactly 1 metered call, got ${meteredCalls}`);
  }

  return {
    challengeStatus: challenge.status,
    challengeAmount: requirements.amount,
    paidStatus: paidResponse.status,
    paidBody,
    meteredCalls,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then((result) => {
      console.log("[x402-paid-api]", JSON.stringify(result, null, 2));
    })
    .catch((err) => {
      console.error("[x402-paid-api] failed", err);
      process.exitCode = 1;
    });
}
