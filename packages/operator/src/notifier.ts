/**
 * Escalation notifications to the human owner, behind an `AlertChannel`
 * interface: email through `@settlekit/notifications` (Resend) and a Discord
 * webhook. Escalation state is saved before notifying, so a failing channel
 * is reported to `onError` and never blocks or loses an escalation.
 */
import { escapeHtml, htmlLayout, htmlRow, textBlock, textLine, type EmailClient } from "@settlekit/notifications";
import type { Escalation, EscalationEvent, EscalationNotifier } from "./escalation.js";
import { outflow } from "./trace.js";
import { formatUsdc } from "./usdc.js";

export interface OperatorAlert {
  readonly subject: string;
  readonly lines: readonly (readonly [string, string])[];
  readonly link?: string;
  readonly escalation: Escalation;
  readonly event: EscalationEvent;
}

export interface AlertChannel {
  readonly name: string;
  send(alert: OperatorAlert): Promise<void>;
}

export function buildAlert(escalation: Escalation, event: EscalationEvent, consoleUrl?: string): OperatorAlert {
  const action = escalation.proposal.action;
  const flow = outflow(action);
  const verb = event === "opened" ? "needs your approval" : `was ${event}`;
  const lines: (readonly [string, string])[] = [
    ["Escalation", escalation.id],
    ["Action", action.kind === "escalate" && action.subject ? action.subject.kind : action.kind],
    ...(flow ? ([["Amount", `${formatUsdc(flow.amount)} USDC`], ["Payee", flow.to]] as const) : []),
    ["Reasons", escalation.reasons.join(", ") || "none"],
    ["Agent rationale", escalation.proposal.rationale],
    ["Expires", escalation.expiresAt],
  ];
  return {
    subject: `SettleKit operator: escalation ${verb}`,
    lines,
    ...(consoleUrl ? { link: `${consoleUrl.replace(/\/+$/, "")}/escalations/${encodeURIComponent(escalation.id)}` } : {}),
    escalation,
    event,
  };
}

export function createEmailChannel(email: EmailClient, to: readonly string[]): AlertChannel {
  return {
    name: "email",
    async send(alert) {
      const rows = alert.lines.map(([k, v]) => htmlRow(k, v)).join("");
      const link = alert.link ? `<p><a href="${escapeHtml(alert.link)}">Review in the operator console</a></p>` : "";
      await email.send({
        to: [...to],
        subject: alert.subject,
        html: htmlLayout({ title: alert.subject, body: `<h2>${escapeHtml(alert.subject)}</h2><table width="100%">${rows}</table>${link}` }),
        text: textBlock([alert.subject, alert.lines.map(([k, v]) => textLine(k, v)).join("\n"), alert.link ?? ""]),
        tags: [{ name: "category", value: "operator_escalation" }],
      });
    },
  };
}

const DISCORD_LIMIT = 1900;

export function createDiscordWebhookChannel(url: string, fetchImpl: typeof fetch = fetch): AlertChannel {
  if (!/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(url)) {
    throw new Error("Discord webhook URL must be https://discord.com/api/webhooks/...");
  }
  return {
    name: "discord",
    async send(alert) {
      const body = [`**${alert.subject}**`, ...alert.lines.map(([k, v]) => `${k}: ${v}`), alert.link ?? ""].filter(Boolean).join("\n");
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // No mentions: agent/vendor text must never ping @everyone or roles.
        body: JSON.stringify({ content: body.slice(0, DISCORD_LIMIT), allowed_mentions: { parse: [] } }),
      });
      if (!res.ok) throw new Error(`Discord webhook returned ${res.status}`);
    },
  };
}

export interface EscalationNotifierOptions {
  readonly consoleUrl?: string;
  /** Which lifecycle events to notify on; defaults to all. */
  readonly events?: readonly EscalationEvent[];
  readonly onError?: (channel: string, error: unknown) => void;
}

export function createEscalationNotifier(channels: readonly AlertChannel[], options: EscalationNotifierOptions = {}): EscalationNotifier {
  const wanted = new Set(options.events ?? ["opened", "approved", "rejected", "expired"]);
  return async (escalation, event) => {
    if (!wanted.has(event)) return;
    const alert = buildAlert(escalation, event, options.consoleUrl);
    await Promise.all(
      channels.map(async (c) => {
        try {
          await c.send(alert);
        } catch (error) {
          options.onError?.(c.name, error);
        }
      }),
    );
  };
}
