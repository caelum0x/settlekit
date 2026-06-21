// In-app notification feed for the header bell.
//
// The api client is server-only (reads the httpOnly sk_session cookie), so the
// `"use client"` NotificationBell cannot import it directly. This route bridges
// the gap: it reads the session token, calls the server api, and returns the
// shared { data, error } envelope as JSON for the client to fetch.
//
// There is no dedicated /v1/notifications endpoint, so the feed is derived from
// the org-wide delivery-runs stream — failed/retrying runs surface as warnings,
// succeeded runs as informational activity.

import { NextResponse } from "next/server";
import { getSessionToken } from "@/lib/session";
import { api } from "@/lib/api";
import { humanize } from "@/lib/format";
import type { DeliveryRun } from "@/lib/types";

export const dynamic = "force-dynamic";

export type NotificationLevel = "info" | "warn" | "error";

export interface Notification {
  id: string;
  title: string;
  detail: string;
  level: NotificationLevel;
  at: string;
}

const MAX_NOTIFICATIONS = 12;

function levelForRun(status: DeliveryRun["status"]): NotificationLevel {
  if (status === "failed") return "error";
  if (status === "pending" || status === "retrying") return "warn";
  return "info";
}

function toNotification(run: DeliveryRun): Notification {
  const action = humanize(run.action);
  const detail =
    run.status === "failed"
      ? `${action} to ${run.customerEmail} failed after ${run.attempts} attempt(s).`
      : `${action} for ${run.productName} → ${run.customerEmail}.`;
  return {
    id: run.id,
    title: `Delivery ${run.status}`,
    detail,
    level: levelForRun(run.status),
    at: run.startedAt,
  };
}

export async function GET(): Promise<NextResponse> {
  const token = getSessionToken();
  if (!token) {
    return NextResponse.json({ data: null, error: "Not signed in" }, { status: 401 });
  }

  const runs = await api.delivery.runs();
  if (runs.error) {
    return NextResponse.json({ data: null, error: runs.error }, { status: 400 });
  }

  const notifications: Notification[] = runs.data
    .slice()
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, MAX_NOTIFICATIONS)
    .map(toNotification);

  return NextResponse.json({ data: notifications, error: null });
}
