/**
 * Solana Pay URL tests against the examples in the Solana Pay specification
 * (https://docs.solanapay.com/spec).
 */
import { describe, expect, it } from "vitest";
import {
  SolanaPayUrlError,
  encodeTransactionRequestUrl,
  encodeTransferRequestUrl,
  parseSolanaPayUrl,
} from "../src/pay-url.js";
import { REFERENCE, USDC } from "./fixtures.js";

const RECIPIENT = "mvines9iiHiQTysrwkJjGf2gb9Ex9jXJX8ns3qwf2kN";

describe("transfer request URLs (spec examples)", () => {
  it("encodes a bare recipient", () => {
    expect(encodeTransferRequestUrl({ recipient: RECIPIENT })).toBe(
      "solana:mvines9iiHiQTysrwkJjGf2gb9Ex9jXJX8ns3qwf2kN",
    );
  });

  it("encodes 1 SOL with label, message and memo", () => {
    const url = encodeTransferRequestUrl({
      recipient: RECIPIENT,
      amount: "1",
      label: "Michael",
      message: "Thanks for all the fish",
      memo: "OrderId12345",
    });
    expect(url).toBe(
      "solana:mvines9iiHiQTysrwkJjGf2gb9Ex9jXJX8ns3qwf2kN?amount=1&label=Michael&message=Thanks%20for%20all%20the%20fish&memo=OrderId12345",
    );
  });

  it("encodes 0.01 USDC", () => {
    const url = encodeTransferRequestUrl(
      { recipient: RECIPIENT, amount: "0.01", splToken: USDC },
      { maxDecimals: 6 },
    );
    expect(url).toBe(
      "solana:mvines9iiHiQTysrwkJjGf2gb9Ex9jXJX8ns3qwf2kN?amount=0.01&spl-token=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    );
  });

  it("parses the spec's full example", () => {
    const parsed = parseSolanaPayUrl(
      "solana:mvines9iiHiQTysrwkJjGf2gb9Ex9jXJX8ns3qwf2kN?amount=1&label=Michael&message=Thanks%20for%20all%20the%20fish&memo=OrderId12345",
    );
    expect(parsed).toEqual({
      kind: "transfer",
      recipient: RECIPIENT,
      amount: "1",
      label: "Michael",
      message: "Thanks for all the fish",
      memo: "OrderId12345",
    });
  });

  it("round-trips amount, spl-token and repeated references", () => {
    const url = encodeTransferRequestUrl({
      recipient: RECIPIENT,
      amount: "12.500000",
      splToken: USDC,
      references: [REFERENCE, USDC],
      label: "SettleKit",
    });
    expect(url).toContain("amount=12.5&");
    expect(url).toContain(`reference=${REFERENCE}&reference=${USDC}`);
    expect(parseSolanaPayUrl(url)).toEqual({
      kind: "transfer",
      recipient: RECIPIENT,
      amount: "12.5",
      splToken: USDC,
      references: [REFERENCE, USDC],
      label: "SettleKit",
    });
  });

  it("normalizes a leading-zero amount and rejects malformed amounts", () => {
    expect(encodeTransferRequestUrl({ recipient: RECIPIENT, amount: "000.50" })).toContain("amount=0.5");
    expect(() => encodeTransferRequestUrl({ recipient: RECIPIENT, amount: ".5" })).toThrow(SolanaPayUrlError);
    expect(() => encodeTransferRequestUrl({ recipient: RECIPIENT, amount: "1e3" })).toThrow(SolanaPayUrlError);
    expect(() => encodeTransferRequestUrl({ recipient: RECIPIENT, amount: "-1" })).toThrow(SolanaPayUrlError);
  });

  it("rejects amounts finer than the mint's decimals", () => {
    expect(() =>
      encodeTransferRequestUrl({ recipient: RECIPIENT, amount: "0.0000001", splToken: USDC }, { maxDecimals: 6 }),
    ).toThrow(/decimal places/);
  });

  it("rejects non-base58 recipients and references", () => {
    expect(() => encodeTransferRequestUrl({ recipient: "0xdeadbeef" })).toThrow(SolanaPayUrlError);
    expect(() => encodeTransferRequestUrl({ recipient: RECIPIENT, references: ["nope"] })).toThrow(
      SolanaPayUrlError,
    );
    expect(() => parseSolanaPayUrl("solana:not-an-address")).toThrow(SolanaPayUrlError);
    expect(() => parseSolanaPayUrl("bitcoin:abc")).toThrow(SolanaPayUrlError);
  });
});

describe("transaction request URLs (spec examples)", () => {
  it("encodes a link without a query verbatim", () => {
    expect(encodeTransactionRequestUrl({ link: "https://example.com/solana-pay" })).toBe(
      "solana:https://example.com/solana-pay",
    );
  });

  it("URL-encodes a link that carries query parameters", () => {
    expect(encodeTransactionRequestUrl({ link: "https://example.com/solana-pay?order=12345" })).toBe(
      "solana:https%3A%2F%2Fexample.com%2Fsolana-pay%3Forder%3D12345",
    );
  });

  it("parses both encoded and plain links", () => {
    expect(parseSolanaPayUrl("solana:https%3A%2F%2Fexample.com%2Fsolana-pay%3Forder%3D12345")).toEqual({
      kind: "transaction",
      link: "https://example.com/solana-pay?order=12345",
    });
    expect(parseSolanaPayUrl("solana:https://example.com/solana-pay")).toEqual({
      kind: "transaction",
      link: "https://example.com/solana-pay",
    });
  });

  it("rejects non-https links", () => {
    expect(() => encodeTransactionRequestUrl({ link: "http://example.com/pay" })).toThrow(SolanaPayUrlError);
    expect(() => parseSolanaPayUrl("solana:http%3A%2F%2Fexample.com%2Fpay")).toThrow(SolanaPayUrlError);
  });
});
