import { createHmac, timingSafeEqual } from "node:crypto";
import type { WebhookEvent } from "@settlekit/common";

export function signWebhookPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function verifyWebhookSignature(payload: string, secret: string, signature: string): boolean {
  const expected = Buffer.from(signWebhookPayload(payload, secret), "hex");
  const actual = Buffer.from(signature, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function serializeWebhookEvent(event: WebhookEvent): string {
  return JSON.stringify(event);
}
