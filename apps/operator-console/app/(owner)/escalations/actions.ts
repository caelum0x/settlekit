"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { describeError } from "@/lib/api-client";
import { operatorApi } from "@/lib/server-api";
import { requireOwner } from "@/lib/session";

const ID_RE = /^[\w:-]{1,128}$/;

function back(params: Record<string, string>): never {
  redirect(`/escalations?${new URLSearchParams(params).toString()}`);
}

async function resolve(kind: "approve" | "reject", formData: FormData): Promise<void> {
  requireOwner("/escalations");
  const id = String(formData.get("id") ?? "");
  if (!ID_RE.test(id)) back({ error: "Unknown escalation." });
  const reason = String(formData.get("reason") ?? "").trim();
  if (kind === "reject" && (reason.length === 0 || reason.length > 1000)) back({ error: "Give a reason (up to 1000 characters) to reject." });
  let outcome: string;
  try {
    const api = operatorApi();
    const decision = kind === "approve" ? await api.approve(id) : await api.reject(id, reason);
    outcome = decision.outcome;
  } catch (error) {
    back({ error: describeError(error).slice(0, 300) });
  }
  revalidatePath("/escalations");
  revalidatePath("/");
  back({ done: kind === "approve" ? "approved" : "rejected", outcome });
}

export async function approveEscalation(formData: FormData): Promise<void> {
  await resolve("approve", formData);
}

export async function rejectEscalation(formData: FormData): Promise<void> {
  await resolve("reject", formData);
}
