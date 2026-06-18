# @settlekit/streaming

Per-second, continuous-authorization payment streams (Lepton RFB 4) — the "streaming payments are a real code gap in x402" lane.

The viewer authorizes a **rate** (USDC/second) and a **reserve** (the maximum to commit) instead of a fixed price. Value accrues in real time while the stream is active, settles in batches, pauses the instant delivery drops (proof-of-flow), and refunds the reserved-but-unused remainder when the stream stops. The meter is computed in USDC base units over an injectable millisecond clock, so it is exact and fully deterministic under test.

```ts
import { openStream } from "@settlekit/streaming";

const stream = openStream({
  payer: "0xviewer", payee: "0xstreamer", network: "arc",
  ratePerSecondUsdc: "0.0001", reserveUsdc: "0.01",
});

stream.reportFlow(false);          // delivery dropped -> meter pauses, not billed
stream.reportFlow(true);           // recovered -> resumes
await stream.settle(sink);         // batch-settle accrued-but-unsettled value
const { finalSettlement, refund } = await stream.close(); // stop + settle tail + refund unused reserve
```

`stream.snapshot()` returns the live meter: `state`, `accruedUsdc`, `settledUsdc`, `dueUsdc`, `refundableUsdc`.
