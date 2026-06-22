/**
 * Copyright 2026 Circle Internet Group, Inc.  All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ArrowUpRight, ArrowDownLeft, Activity } from "lucide-react";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const metadata = {
  title: "Activity · Arc Pay",
};

const INBOUND_TYPES = ["USDC_TRANSFER_IN", "INBOUND", "received"];
const OUTBOUND_TYPES = ["USDC_TRANSFER_OUT", "OUTBOUND", "sent"];

interface TransactionRow {
  transaction_type: string;
  amount: number | string;
  status: string;
  created_at: string;
}

function formatUsd(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function isInbound(type: string): boolean {
  return INBOUND_TYPES.includes(type);
}

export default async function ActivityPage() {
  const supabase = await createSupabaseServerComponentClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return redirect("/sign-in");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("auth_user_id", user.id)
    .single();

  if (!profile) {
    return redirect("/sign-in");
  }

  const { data: transactions } = await supabase
    .from("transactions")
    .select("transaction_type, amount, status, created_at")
    .eq("profile_id", profile.id)
    .order("created_at", { ascending: false });

  const rows: TransactionRow[] = transactions ?? [];

  let totalSent = 0;
  let totalReceived = 0;
  let sentCount = 0;
  let receivedCount = 0;
  let pendingCount = 0;

  const now = new Date();
  const thisMonth = now.getMonth();
  const thisYear = now.getFullYear();
  let sentThisMonth = 0;
  let receivedThisMonth = 0;

  for (const tx of rows) {
    const amount = Number(tx.amount) || 0;
    const inMonth =
      new Date(tx.created_at).getMonth() === thisMonth &&
      new Date(tx.created_at).getFullYear() === thisYear;

    if ((tx.status || "").toUpperCase() === "PENDING") {
      pendingCount += 1;
    }

    if (isInbound(tx.transaction_type)) {
      totalReceived += amount;
      receivedCount += 1;
      if (inMonth) receivedThisMonth += amount;
    } else if (OUTBOUND_TYPES.includes(tx.transaction_type)) {
      totalSent += amount;
      sentCount += 1;
      if (inMonth) sentThisMonth += amount;
    }
  }

  const net = totalReceived - totalSent;
  const totalCount = rows.length;
  const monthLabel = now.toLocaleString("default", { month: "long" });

  return (
    <div className="flex flex-col flex-1 h-full overflow-y-auto pb-4">
      <div className="sticky top-0 bg-background z-10 pb-2 mb-4 flex items-center">
        <Button asChild variant="ghost" size="icon" className="mr-2">
          <Link href="/dashboard" aria-label="Back to dashboard">
            <ChevronLeft className="h-5 w-5" />
          </Link>
        </Button>
        <h2 className="text-lg font-bold">Activity &amp; insights</h2>
      </div>

      {totalCount === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center text-center px-6 gap-3">
          <Activity className="h-12 w-12 text-muted-foreground/40" />
          <p className="text-lg font-medium">No activity yet</p>
          <p className="text-sm text-muted-foreground">
            Once you send or receive USDC, your insights will appear here.
          </p>
          <Button asChild className="mt-2">
            <Link href="/dashboard">Make your first payment</Link>
          </Button>
        </div>
      ) : (
        <>
          {/* Net flow headline */}
          <Card className="w-full mb-4">
            <CardHeader>
              <CardTitle className="text-base">Net flow</CardTitle>
            </CardHeader>
            <CardContent>
              <p
                className={`text-3xl font-bold ${
                  net >= 0 ? "text-green-600" : "text-red-600"
                }`}
              >
                {net >= 0 ? "+" : "-"}${formatUsd(Math.abs(net))}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Across {totalCount} transaction{totalCount === 1 ? "" : "s"}
              </p>
            </CardContent>
          </Card>

          {/* Sent / received split */}
          <div className="grid grid-cols-2 gap-4 mb-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-1 text-muted-foreground">
                  <ArrowDownLeft className="h-4 w-4 text-green-600" />
                  Received
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xl font-semibold">
                  ${formatUsd(totalReceived)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {receivedCount} payment{receivedCount === 1 ? "" : "s"}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-1 text-muted-foreground">
                  <ArrowUpRight className="h-4 w-4 text-red-600" />
                  Sent
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xl font-semibold">${formatUsd(totalSent)}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {sentCount} payment{sentCount === 1 ? "" : "s"}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* This month */}
          <Card className="w-full mb-4">
            <CardHeader>
              <CardTitle className="text-base">{monthLabel} so far</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Received</span>
                <span className="font-medium text-green-600">
                  +${formatUsd(receivedThisMonth)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Sent</span>
                <span className="font-medium text-red-600">
                  -${formatUsd(sentThisMonth)}
                </span>
              </div>
              <div className="flex justify-between text-sm border-t pt-2">
                <span className="text-muted-foreground">Net</span>
                <span className="font-medium">
                  {receivedThisMonth - sentThisMonth >= 0 ? "+" : "-"}$
                  {formatUsd(Math.abs(receivedThisMonth - sentThisMonth))}
                </span>
              </div>
            </CardContent>
          </Card>

          {pendingCount > 0 && (
            <p className="text-sm text-muted-foreground text-center">
              {pendingCount} transaction{pendingCount === 1 ? "" : "s"} still
              pending
            </p>
          )}
        </>
      )}
    </div>
  );
}
