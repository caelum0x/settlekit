import { describe, expect, it } from "vitest";
import type { WebhookEndpoint } from "@settlekit/common";
import {
  buildWebhookRequest,
  parseSignatureHeader,
  signPayload,
  signPayloadWithSecrets,
  signingSecretsFor,
  verifySignature,
} from "../src/index.js";

const endpoint: WebhookEndpoint = {
  id: "we_1",
  organizationId: "org_1",
  url: "https://hooks.test/settlekit",
  signingSecret: "new_secret",
  enabledEvents: ["payment.confirmed"],
  active: true,
  createdAt: "2026-09-01T00:00:00.000Z",
  previousSigningSecret: "old_secret",
  previousSecretExpiresAt: "2026-09-30T12:00:00.000Z",
};

describe("secret rotation", () => {
  it("signs with both secrets during the grace window and only the new one after", () => {
    const during = Date.parse("2026-09-30T11:00:00.000Z");
    const after = Date.parse("2026-09-30T12:00:01.000Z");
    expect(signingSecretsFor(endpoint, during)).toEqual(["new_secret", "old_secret"]);
    expect(signingSecretsFor(endpoint, after)).toEqual(["new_secret"]);
    expect(signingSecretsFor({ ...endpoint, previousSigningSecret: undefined }, during)).toEqual(["new_secret"]);

    const request = buildWebhookRequest({
      endpoint,
      event: { id: "evt_1", organizationId: "org_1", type: "payment.confirmed", data: {}, createdAt: "2026-09-30T11:00:00.000Z" },
      clock: () => during,
    });
    const header = request.headers["SettleKit-Signature"]!;
    expect(parseSignatureHeader(header)?.signatures).toHaveLength(2);
    const t = Math.floor(during / 1000);
    // Receivers on either secret verify the same delivery.
    expect(verifySignature("new_secret", request.body, header, 300, t)).toBe(true);
    expect(verifySignature("old_secret", request.body, header, 300, t)).toBe(true);
    expect(verifySignature("other", request.body, header, 300, t)).toBe(false);
  });

  it("keeps single-secret headers byte-identical to signPayload", () => {
    expect(signPayloadWithSecrets(["s"], "{}", 100)).toBe(signPayload("s", "{}", 100));
    expect(signPayloadWithSecrets(["s", "s", ""], "{}", 100)).toBe(signPayload("s", "{}", 100));
    expect(() => signPayloadWithSecrets([""], "{}", 100)).toThrow();
  });
});
