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

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface TransactionRow {
  tx_type: string;
  amount: number | string | null;
  status: string | null;
  chain: string;
  destination_chain: string | null;
  created_at: string;
}

export interface AnalyticsResponse {
  totals: {
    transactionCount: number;
    depositCount: number;
    transferCount: number;
    totalDeposited: number;
    totalTransferred: number;
    successRate: number;
  };
  statusBreakdown: { status: string; count: number }[];
  chainBreakdown: { chain: string; count: number; volume: number }[];
  recentActivity: { date: string; count: number }[];
}

const toNumber = (value: number | string | null): number => {
  if (value === null) return 0;
  const parsed = typeof value === "number" ? value : parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    const { data, error } = await supabase
      .from("transaction_history")
      .select("tx_type, amount, status, chain, destination_chain, created_at")
      .eq("user_id", user.id);

    if (error) {
      console.error("Error fetching analytics:", error);
      return NextResponse.json(
        { message: "Error fetching analytics" },
        { status: 500 }
      );
    }

    const rows = (data ?? []) as TransactionRow[];

    let depositCount = 0;
    let transferCount = 0;
    let totalDeposited = 0;
    let totalTransferred = 0;
    let successCount = 0;

    const statusMap = new Map<string, number>();
    const chainMap = new Map<string, { count: number; volume: number }>();
    const dayMap = new Map<string, number>();

    for (const row of rows) {
      const amount = toNumber(row.amount);
      const status = row.status ?? "success";

      statusMap.set(status, (statusMap.get(status) ?? 0) + 1);
      if (status === "success") successCount += 1;

      if (row.tx_type === "deposit") {
        depositCount += 1;
        if (status === "success") totalDeposited += amount;
      } else if (row.tx_type === "transfer") {
        transferCount += 1;
        if (status === "success") totalTransferred += amount;
      }

      const existing = chainMap.get(row.chain) ?? { count: 0, volume: 0 };
      chainMap.set(row.chain, {
        count: existing.count + 1,
        volume: existing.volume + (status === "success" ? amount : 0),
      });

      const day = row.created_at.slice(0, 10);
      dayMap.set(day, (dayMap.get(day) ?? 0) + 1);
    }

    const transactionCount = rows.length;
    const successRate =
      transactionCount > 0
        ? Math.round((successCount / transactionCount) * 1000) / 10
        : 0;

    const statusBreakdown = Array.from(statusMap.entries())
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count);

    const chainBreakdown = Array.from(chainMap.entries())
      .map(([chain, value]) => ({ chain, count: value.count, volume: value.volume }))
      .sort((a, b) => b.count - a.count);

    const recentActivity = Array.from(dayMap.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, 7)
      .reverse();

    const response: AnalyticsResponse = {
      totals: {
        transactionCount,
        depositCount,
        transferCount,
        totalDeposited,
        totalTransferred,
        successRate,
      },
      statusBreakdown,
      chainBreakdown,
      recentActivity,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error fetching analytics:", error);
    return NextResponse.json(
      { message: "Error fetching analytics" },
      { status: 500 }
    );
  }
}
