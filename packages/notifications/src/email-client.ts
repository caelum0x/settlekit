/**
 * High-level email client.
 *
 * `createEmailClient({ apiKey, from })` returns an `EmailClient` whose `send`
 * method renders nothing — it forwards a fully-formed payload to a transport.
 * By default it uses the REAL `ResendTransport`; callers may inject any
 * `EmailTransport` (e.g. an in-memory one in tests).
 */

import { SettleKitError } from "@settlekit/common";
import type { EmailPayload, EmailTransport, SendResult } from "./transports.js";
import { ResendTransport } from "./transports.js";

export interface EmailClientOptions {
  /** Resend API key. Required when using the default transport. */
  apiKey?: string;
  /** Default `from` address, e.g. "SettleKit <receipts@settlekit.dev>". */
  from: string;
  /**
   * Optional custom transport. When omitted, a `ResendTransport` is built from
   * `apiKey`. Tests pass an in-memory transport here.
   */
  transport?: EmailTransport;
}

/** Arguments accepted by `EmailClient.send`. */
export interface SendArgs {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  tags?: ReadonlyArray<{ name: string; value: string }>;
}

export interface EmailClient {
  readonly from: string;
  send(args: SendArgs): Promise<SendResult>;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function assertRecipients(to: string | string[]): void {
  const list = Array.isArray(to) ? to : [to];
  if (list.length === 0) {
    throw new SettleKitError({ code: "validation_error", message: "At least one recipient is required" });
  }
  for (const addr of list) {
    if (!EMAIL_RE.test(addr)) {
      throw new SettleKitError({
        code: "validation_error",
        message: `Invalid recipient address: ${addr}`,
      });
    }
  }
}

export function createEmailClient(options: EmailClientOptions): EmailClient {
  if (!options.from) {
    throw new SettleKitError({ code: "validation_error", message: "from address is required" });
  }

  const transport: EmailTransport =
    options.transport ??
    new ResendTransport({
      apiKey: requireApiKey(options.apiKey),
    });

  const from = options.from;

  return {
    from,
    async send(args: SendArgs): Promise<SendResult> {
      assertRecipients(args.to);
      if (!args.subject) {
        throw new SettleKitError({ code: "validation_error", message: "subject is required" });
      }
      if (!args.html) {
        throw new SettleKitError({ code: "validation_error", message: "html body is required" });
      }

      const payload: EmailPayload = {
        to: args.to,
        subject: args.subject,
        html: args.html,
      };
      if (args.text !== undefined) payload.text = args.text;
      if (args.from !== undefined) payload.from = args.from;
      if (args.replyTo !== undefined) payload.replyTo = args.replyTo;
      if (args.cc !== undefined) payload.cc = args.cc;
      if (args.bcc !== undefined) payload.bcc = args.bcc;
      if (args.tags !== undefined) payload.tags = args.tags;

      return transport.send(payload, from);
    },
  };
}

function requireApiKey(apiKey: string | undefined): string {
  if (!apiKey) {
    throw new SettleKitError({
      code: "validation_error",
      message: "apiKey is required when no transport is supplied",
    });
  }
  return apiKey;
}
