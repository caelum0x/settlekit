import { describe, expect, it } from "vitest";
import { generateKeyPairSync, sign as nodeSign } from "node:crypto";
import {
  verifyCircleSignature,
  parseCircleNotification,
  extractTransaction,
} from "../src/inbound.js";

/** Generate an EC P-256 keypair and return the SPKI public key as base64 (as Circle serves it). */
function ecKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const spkiDer = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  return { privateKey, publicKeyBase64: spkiDer.toString("base64") };
}

function signBody(body: string, privateKey: ReturnType<typeof ecKeypair>["privateKey"]): string {
  return nodeSign("sha256", Buffer.from(body, "utf8"), privateKey).toString("base64");
}

describe("verifyCircleSignature", () => {
  const body = JSON.stringify({ notificationId: "n_1", notificationType: "transactions.outbound" });

  it("accepts a valid ECDSA-SHA256 signature", () => {
    const { privateKey, publicKeyBase64 } = ecKeypair();
    const sig = signBody(body, privateKey);
    expect(verifyCircleSignature(body, sig, publicKeyBase64)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const { privateKey, publicKeyBase64 } = ecKeypair();
    const sig = signBody(body, privateKey);
    expect(verifyCircleSignature(body + " ", sig, publicKeyBase64)).toBe(false);
  });

  it("rejects a signature from a different key", () => {
    const a = ecKeypair();
    const b = ecKeypair();
    const sig = signBody(body, a.privateKey);
    expect(verifyCircleSignature(body, sig, b.publicKeyBase64)).toBe(false);
  });

  it("rejects empty/malformed inputs without throwing", () => {
    expect(verifyCircleSignature("", "x", "y")).toBe(false);
    expect(verifyCircleSignature(body, "not-base64!!", "also-bad")).toBe(false);
  });
});

describe("parseCircleNotification + extractTransaction", () => {
  it("parses a transactions.* notification and extracts the transaction", () => {
    const raw = JSON.stringify({
      notificationId: "n_2",
      notificationType: "transactions.outbound",
      notification: { id: "tx_1", state: "COMPLETE", txHash: "0xabc", refId: "po_1" },
    });
    const parsed = parseCircleNotification(raw);
    expect(parsed?.notificationId).toBe("n_2");
    const tx = extractTransaction(parsed!);
    expect(tx?.refId).toBe("po_1");
    expect(tx?.txHash).toBe("0xabc");
    expect(tx?.state).toBe("COMPLETE");
  });

  it("returns null on invalid JSON", () => {
    expect(parseCircleNotification("{not json")).toBeNull();
  });
});
