/**
 * @settlekit/notifications
 *
 * Transactional email + receipts for SettleKit. Real email delivery via the
 * Resend REST API, plus pure renderers for receipts and access-granted
 * delivery-instruction emails.
 */

export type {
  EmailPayload,
  SendResult,
  EmailTransport,
  ResendTransportOptions,
} from "./transports.js";
export { ResendTransport, buildResendRequest } from "./transports.js";

export type { EmailClient, EmailClientOptions, SendArgs } from "./email-client.js";
export { createEmailClient } from "./email-client.js";

export type {
  ReceiptLineItem,
  AccessInstruction,
  AccessGrantedArgs,
} from "./receipts.js";
export {
  sumLineItems,
  renderReceiptHtml,
  renderReceiptText,
  renderAccessGrantedEmail,
  renderAccessGrantedText,
} from "./receipts.js";

export {
  escapeHtml,
  formatUsdc,
  htmlLayout,
  htmlRow,
  textLine,
  textBlock,
} from "./templates.js";

// --- Backwards-compatible lightweight notification helper ---

export type NotificationChannel = "email" | "webhook" | "dashboard";

export interface NotificationMessage {
  channel: NotificationChannel;
  subject: string;
  body: string;
  to?: string;
}

export function buildReceiptNotification(to: string, amount: string): NotificationMessage {
  return {
    channel: "email",
    to,
    subject: "Your SettleKit receipt",
    body: `Payment received: ${amount} USDC`,
  };
}
