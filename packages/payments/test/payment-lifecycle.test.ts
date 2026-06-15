import { describe, it, expect } from "vitest";
import { SettleKitError } from "@settlekit/common";
import {
  recordPendingPayment,
  confirmPayment,
  failPayment,
  refundPayment,
  isTerminalPayment,
} from "../src/index.js";
import { USDC } from "./helpers.js";

const NOW = new Date("2026-06-15T00:00:00.000Z");

function pending() {
  return recordPendingPayment(
    {
      organizationId: "org_1",
      checkoutSessionId: "cs_1",
      customerId: "cus_1",
      amount: USDC("25"),
      network: "arc",
    },
    NOW,
  );
}

describe("recordPendingPayment", () => {
  it("starts pending with zero confirmations", () => {
    const p = pending();
    expect(p.status).toBe("pending");
    expect(p.confirmations).toBe(0);
    expect(p.id.startsWith("pay_")).toBe(true);
    expect(p.confirmedAt).toBeUndefined();
  });
});

describe("confirmPayment min-confirmations rule", () => {
  it("confirms when confirmations >= minConfirmations", () => {
    const p = pending();
    const c = confirmPayment(p, "0xhash", 3, 2, NOW);
    expect(c).not.toBe(p);
    expect(c.status).toBe("confirmed");
    expect(c.txHash).toBe("0xhash");
    expect(c.confirmations).toBe(3);
    expect(c.confirmedAt).toBe(NOW.toISOString());
    // original untouched
    expect(p.status).toBe("pending");
  });

  it("rejects when below the required confirmations", () => {
    const p = pending();
    expect(() => confirmPayment(p, "0xhash", 1, 3)).toThrow(SettleKitError);
    // the payment remains pending (no mutation)
    expect(p.status).toBe("pending");
  });

  it("uses default min confirmations of 1", () => {
    const p = pending();
    expect(() => confirmPayment(p, "0xhash", 0)).toThrow(SettleKitError);
    const c = confirmPayment(p, "0xhash", 1);
    expect(c.status).toBe("confirmed");
  });

  it("requires a non-empty txHash", () => {
    const p = pending();
    expect(() => confirmPayment(p, "  ", 5, 1)).toThrow(SettleKitError);
  });

  it("is idempotent for the same txHash", () => {
    const c = confirmPayment(pending(), "0xhash", 5, 1, NOW);
    expect(confirmPayment(c, "0xhash", 5, 1, NOW)).toBe(c);
  });

  it("conflicts when re-confirming with a different txHash", () => {
    const c = confirmPayment(pending(), "0xhash", 5, 1, NOW);
    expect(() => confirmPayment(c, "0xother", 5, 1, NOW)).toThrow(SettleKitError);
  });
});

describe("failPayment", () => {
  it("fails a pending payment", () => {
    const f = failPayment(pending());
    expect(f.status).toBe("failed");
    expect(isTerminalPayment(f)).toBe(true);
  });

  it("cannot fail a confirmed payment", () => {
    const c = confirmPayment(pending(), "0xhash", 5, 1, NOW);
    expect(() => failPayment(c)).toThrow(SettleKitError);
  });
});

describe("refundPayment transitions", () => {
  it("refunds a confirmed payment", () => {
    const c = confirmPayment(pending(), "0xhash", 5, 1, NOW);
    const r = refundPayment(c);
    expect(r).not.toBe(c);
    expect(r.status).toBe("refunded");
    expect(c.status).toBe("confirmed");
    expect(isTerminalPayment(r)).toBe(true);
  });

  it("is idempotent once refunded", () => {
    const r = refundPayment(confirmPayment(pending(), "0xhash", 5, 1, NOW));
    expect(refundPayment(r)).toBe(r);
  });

  it("refuses to refund a pending payment", () => {
    expect(() => refundPayment(pending())).toThrow(SettleKitError);
  });

  it("refuses to refund a failed payment", () => {
    const f = failPayment(pending());
    expect(() => refundPayment(f)).toThrow(SettleKitError);
  });
});
