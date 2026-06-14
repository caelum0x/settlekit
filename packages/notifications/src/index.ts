export type NotificationChannel = "email" | "webhook" | "dashboard";

export interface NotificationMessage {
  channel: NotificationChannel;
  subject: string;
  body: string;
  to?: string;
}

export function buildReceiptNotification(to: string, amount: string): NotificationMessage {
  return { channel: "email", to, subject: "Your SettleKit receipt", body: `Payment received: ${amount} USDC` };
}
