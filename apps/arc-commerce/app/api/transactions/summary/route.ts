/**
 * Copyright 2025 Circle Internet Group, Inc.  All rights reserved.
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
import { createClient as createServerSupabase } from "@/lib/supabase/server";

interface SummaryTransaction {
  amount_usdc: string | number;
  fee_usdc: string | number;
  credit_amount: string | number;
  status: string;
  created_at: string;
}

export interface TransactionSummary {
  totalTransactions: number;
  totalCreditsPurchased: number;
  totalUsdcSpent: number;
  totalFees: number;
  statusCounts: {
    pending: number;
    confirmed: number;
    complete: number;
    failed: number;
  };
  successRate: number;
  lastPurchaseAt: string | null;
}

/**
 * GET /api/transactions/summary
 * Returns aggregated lifetime statistics for the authenticated user's
 * credit purchases. Only `complete` transactions count toward spend totals.
 */
export async function GET() {
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: transactions, error: txError } = await supabase
      .from("transactions")
      .select("amount_usdc, fee_usdc, credit_amount, status, created_at")
      .eq("transaction_type", "USER")
      .order("created_at", { ascending: false });

    if (txError) {
      return NextResponse.json(
        { error: "Failed to load summary", details: txError.message },
        { status: 500 }
      );
    }

    const rows = (transactions as SummaryTransaction[] | null) ?? [];

    const statusCounts = {
      pending: 0,
      confirmed: 0,
      complete: 0,
      failed: 0,
    };

    let totalCreditsPurchased = 0;
    let totalUsdcSpent = 0;
    let totalFees = 0;

    for (const tx of rows) {
      const status = tx.status as keyof typeof statusCounts;
      if (status in statusCounts) {
        statusCounts[status] += 1;
      }

      // Only count settled (complete) purchases toward lifetime spend.
      if (tx.status === "complete") {
        totalCreditsPurchased += Number(tx.credit_amount) || 0;
        totalUsdcSpent += Number(tx.amount_usdc) || 0;
        totalFees += Number(tx.fee_usdc) || 0;
      }
    }

    const settledOrFailed = statusCounts.complete + statusCounts.failed;
    const successRate =
      settledOrFailed > 0
        ? Math.round((statusCounts.complete / settledOrFailed) * 100)
        : 0;

    const summary: TransactionSummary = {
      totalTransactions: rows.length,
      totalCreditsPurchased,
      totalUsdcSpent,
      totalFees,
      statusCounts,
      successRate,
      lastPurchaseAt: rows.length > 0 ? rows[0].created_at : null,
    };

    return NextResponse.json({ data: summary }, { status: 200 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Server error", details: message },
      { status: 500 }
    );
  }
}
