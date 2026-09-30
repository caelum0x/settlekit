import { describe, expect, it } from "vitest";
import {
  guardCell,
  inRange,
  ledgerCsv,
  quickBooksDate,
  quickBooksStatementCsv,
  toCsv,
  xeroDate,
  xeroStatementCsv,
  type LedgerEntry,
} from "../src/index.js";

const entries: LedgerEntry[] = [
  {
    date: "2026-09-02T10:00:00.000Z",
    amount: "-5",
    currency: "USDC",
    payee: "buyer@example.com",
    description: "Refund",
    reference: "ref_1",
    network: "base",
    txHash: "0xbbb",
    kind: "refund",
  },
  {
    date: "2026-09-01T10:00:00.000Z",
    amount: "25",
    currency: "USDC",
    payee: "=HYPERLINK(\"http://evil\")",
    description: "Pro license",
    reference: "pay_1",
    network: "base",
    txHash: "0xaaa",
    kind: "payment",
  },
];

describe("accounting exports", () => {
  it("formats dates for each tool", () => {
    expect(xeroDate("2026-09-01T23:59:00.000Z")).toBe("01/09/2026");
    expect(quickBooksDate("2026-09-01T23:59:00.000Z")).toBe("09/01/2026");
    expect(xeroDate("nope")).toBe("");
  });

  it("writes a Xero bank statement sorted by date with formulas neutralized", () => {
    const csv = xeroStatementCsv(inRange(entries));
    const lines = csv.split("\n");
    expect(lines[0]).toBe('"*Date","*Amount","Payee","Description","Reference"');
    expect(lines[1]).toBe(`"01/09/2026","25","'=HYPERLINK(""http://evil"")","Pro license | base | 0xaaa","pay_1"`);
    expect(lines[2]).toBe('"02/09/2026","-5","buyer@example.com","Refund | base | 0xbbb","ref_1"');
  });

  it("writes the QuickBooks three-column upload", () => {
    const csv = quickBooksStatementCsv(inRange(entries));
    expect(csv.split("\n")[0]).toBe('"Date","Description","Amount"');
    expect(csv).toContain('"09/02/2026","buyer@example.com | Refund | base | 0xbbb | ref_1","-5"');
  });

  it("filters by date range and keeps negative numbers unguarded", () => {
    expect(inRange(entries, new Date("2026-09-02T00:00:00Z"))).toHaveLength(1);
    expect(inRange(entries, undefined, new Date("2026-09-02T00:00:00Z"))[0]!.reference).toBe("pay_1");
    expect(guardCell("-5")).toBe("-5");
    expect(guardCell("-cmd")).toBe("'-cmd");
    expect(guardCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(ledgerCsv(entries).split("\n")[0]).toBe('"date","kind","amount","currency","payee","description","reference","network","tx_hash"');
  });

  it("leaves the default toCsv behavior unchanged", () => {
    expect(toCsv([{ a: "=1+1" }], [{ header: "a", value: (r) => r.a }])).toBe('"a"\n"=1+1"');
  });
});
