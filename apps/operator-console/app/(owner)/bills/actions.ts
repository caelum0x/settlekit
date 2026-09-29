"use server";

import { revalidatePath } from "next/cache";
import { describeError } from "@/lib/api-client";
import { parseBillForm } from "@/lib/bill-form";
import type { FieldErrors } from "@/lib/onboarding";
import { operatorApi } from "@/lib/server-api";
import { requireOwner } from "@/lib/session";

export interface BillFormState {
  readonly status: "idle" | "error" | "ok";
  readonly message?: string;
  readonly errors?: FieldErrors;
  readonly decisionId?: string;
}

export async function addBill(_prev: BillFormState, formData: FormData): Promise<BillFormState> {
  requireOwner("/bills");
  const parsed = parseBillForm(Object.fromEntries(formData));
  if (!parsed.ok) return { status: "error", message: "Check the highlighted fields.", errors: parsed.errors };
  try {
    const result = await operatorApi().addBill(parsed.value);
    revalidatePath("/bills");
    revalidatePath("/");
    const outcome = result.decision ? `; the agent's decision: ${result.decision.outcome}` : "; it will be handled when due";
    return {
      status: "ok",
      message: `Bill recorded as ${result.bill.status}${outcome}.`,
      ...(result.decision ? { decisionId: result.decision.id } : {}),
    };
  } catch (error) {
    return { status: "error", message: describeError(error) };
  }
}
