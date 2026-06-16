import { describe, expect, it } from "vitest";
import { SettleKitError } from "@settlekit/common";
import {
  buildIrisUrl,
  createCctpClient,
  fetchAttestation,
  parseFirstMessage,
  waitForAttestation,
} from "../src/index.js";
import type { CctpHttp, CctpRequest, CctpResponse, Hex } from "../src/index.js";

const TX_HASH: Hex =
  "0x1111111111111111111111111111111111111111111111111111111111111111";
const SRC_DOMAIN = 0;

const PENDING_BODY = {
  messages: [
    {
      message: "0x00aa",
      eventNonce: "9683",
      attestation: "PENDING",
      status: "pending_confirmations",
      cctpVersion: 2,
      delayReason: null,
    },
  ],
};

const COMPLETE_BODY = {
  messages: [
    {
      message: "0x00aa",
      eventNonce: "9683",
      attestation: "0xdeadbeefcafe",
      status: "complete",
      cctpVersion: 2,
      delayReason: null,
      decodedMessage: { sourceDomain: "0", destinationDomain: "26" },
    },
  ],
};

/** In-memory CctpHttp that replays a queue of canned responses, recording requests. */
function scriptedHttp(responses: CctpResponse[]): {
  http: CctpHttp;
  calls: CctpRequest[];
} {
  const calls: CctpRequest[] = [];
  let i = 0;
  return {
    calls,
    http: {
      async request(req: CctpRequest): Promise<CctpResponse> {
        calls.push(req);
        const res = responses[Math.min(i, responses.length - 1)];
        i += 1;
        return res;
      },
    },
  };
}

describe("buildIrisUrl", () => {
  it("joins base, path, and query without double slashes", () => {
    const url = buildIrisUrl(
      "https://iris-api-sandbox.circle.com/",
      "/v2/messages/0",
      { transactionHash: TX_HASH },
    );
    expect(url).toBe(
      `https://iris-api-sandbox.circle.com/v2/messages/0?transactionHash=${TX_HASH}`,
    );
  });
});

describe("parseFirstMessage", () => {
  it("parses a complete message with attestation", () => {
    const msg = parseFirstMessage(COMPLETE_BODY);
    expect(msg).not.toBeNull();
    expect(msg?.status).toBe("complete");
    expect(msg?.attestation).toBe("0xdeadbeefcafe");
    expect(msg?.message).toBe("0x00aa");
    expect(msg?.eventNonce).toBe("9683");
  });

  it("treats PENDING attestation as null", () => {
    const msg = parseFirstMessage(PENDING_BODY);
    expect(msg?.status).toBe("pending_confirmations");
    expect(msg?.attestation).toBeNull();
  });

  it("returns null for an empty messages array", () => {
    expect(parseFirstMessage({ messages: [] })).toBeNull();
  });

  it("throws on a message entry missing the message field", () => {
    expect(() =>
      parseFirstMessage({ messages: [{ status: "complete" }] }),
    ).toThrow(SettleKitError);
  });
});

describe("fetchAttestation", () => {
  it("returns null on 404 (not yet indexed)", async () => {
    const { http } = scriptedHttp([{ status: 404, body: null }]);
    const out = await fetchAttestation(http, SRC_DOMAIN, TX_HASH);
    expect(out).toBeNull();
  });

  it("requests the correct path and query", async () => {
    const { http, calls } = scriptedHttp([{ status: 200, body: COMPLETE_BODY }]);
    await fetchAttestation(http, SRC_DOMAIN, TX_HASH);
    expect(calls[0].path).toBe("/v2/messages/0");
    expect(calls[0].query).toEqual({ transactionHash: TX_HASH });
  });

  it("maps a 500 to a retryable integration error", async () => {
    const { http } = scriptedHttp([{ status: 500, body: null }]);
    await expect(fetchAttestation(http, SRC_DOMAIN, TX_HASH)).rejects.toThrow(
      SettleKitError,
    );
  });

  it("rejects malformed tx hashes", async () => {
    const { http } = scriptedHttp([{ status: 200, body: COMPLETE_BODY }]);
    await expect(
      fetchAttestation(http, SRC_DOMAIN, "0x1234" as Hex),
    ).rejects.toThrow(SettleKitError);
  });
});

describe("waitForAttestation", () => {
  it("polls pending -> complete and returns the attested message", async () => {
    const { http, calls } = scriptedHttp([
      { status: 404, body: null },
      { status: 200, body: PENDING_BODY },
      { status: 200, body: COMPLETE_BODY },
    ]);
    const msg = await waitForAttestation(http, SRC_DOMAIN, TX_HASH, {
      pollIntervalMs: 1,
      timeoutMs: 5_000,
    });
    expect(msg.status).toBe("complete");
    expect(msg.attestation).toBe("0xdeadbeefcafe");
    expect(calls.length).toBe(3);
  });

  it("times out while still pending", async () => {
    const { http } = scriptedHttp([{ status: 200, body: PENDING_BODY }]);
    await expect(
      waitForAttestation(http, SRC_DOMAIN, TX_HASH, {
        pollIntervalMs: 1,
        timeoutMs: 5,
      }),
    ).rejects.toThrow(/Timed out waiting for CCTP attestation/);
  });
});

describe("createCctpClient", () => {
  it("waits for attestation then builds the Arc mint tx", async () => {
    const { http } = scriptedHttp([
      { status: 200, body: PENDING_BODY },
      { status: 200, body: COMPLETE_BODY },
    ]);
    const client = createCctpClient({ http });

    const message = await client.waitForAttestation(SRC_DOMAIN, TX_HASH, {
      pollIntervalMs: 1,
      timeoutMs: 5_000,
    });
    const tx = client.buildArcMintTx(message);
    // Arc testnet MessageTransmitterV2.
    expect(tx.to).toBe("0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275");
    expect(tx.value).toBe(0n);
    expect(tx.data.startsWith("0x")).toBe(true);
  });

  it("refuses to build a mint tx from a pending attestation", () => {
    const client = createCctpClient({ http: scriptedHttp([]).http });
    const pending = parseFirstMessage(PENDING_BODY);
    expect(pending).not.toBeNull();
    if (pending) {
      expect(() =>
        client.buildArcMintTx(pending),
      ).toThrow(SettleKitError);
    }
  });

  it("resolves chain names to CCTP domains", () => {
    const client = createCctpClient({ http: scriptedHttp([]).http });
    expect(client.domainFor("arc")).toBe(26);
    expect(client.domainFor("base")).toBe(6);
  });
});
