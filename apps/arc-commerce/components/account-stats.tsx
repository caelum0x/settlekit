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

"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Activity,
  CheckCircle2,
  Coins,
  DollarSign,
  Receipt,
  TrendingUp,
} from "lucide-react";
import { format } from "date-fns";
import type { TransactionSummary } from "@/app/api/transactions/summary/route";

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

interface StatCardProps {
  label: string;
  value: string;
  hint?: string;
  icon: React.ReactNode;
}

function StatCard({ label, value, hint, icon }: StatCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
        <span className="text-muted-foreground">{icon}</span>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold tracking-tight">{value}</div>
        {hint && (
          <p className="text-xs text-muted-foreground mt-1">{hint}</p>
        )}
      </CardContent>
    </Card>
  );
}

function StatCardSkeleton() {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="h-4 w-24 rounded bg-muted animate-pulse" />
        <div className="h-4 w-4 rounded bg-muted animate-pulse" />
      </CardHeader>
      <CardContent>
        <div className="h-7 w-20 rounded bg-muted animate-pulse" />
      </CardContent>
    </Card>
  );
}

export function AccountStats() {
  const [summary, setSummary] = useState<TransactionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        const res = await fetch("/api/transactions/summary");
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          throw new Error(json.error || "Failed to load account stats");
        }
        setSummary(json.data as TransactionSummary);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : "Failed to load account stats"
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Unable to load stats</CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!summary || summary.totalTransactions === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">No activity yet</CardTitle>
          <CardDescription>
            Your purchase statistics will appear here after your first credit
            top-up.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="w-full space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Credits Purchased"
          value={numberFormatter.format(summary.totalCreditsPurchased)}
          hint="Lifetime, settled purchases"
          icon={<Coins className="h-4 w-4" />}
        />
        <StatCard
          label="Total Spent"
          value={usdFormatter.format(summary.totalUsdcSpent)}
          hint={`${usdFormatter.format(summary.totalFees)} in network fees`}
          icon={<DollarSign className="h-4 w-4" />}
        />
        <StatCard
          label="Transactions"
          value={numberFormatter.format(summary.totalTransactions)}
          hint={`${summary.statusCounts.complete} completed`}
          icon={<Receipt className="h-4 w-4" />}
        />
        <StatCard
          label="Success Rate"
          value={`${summary.successRate}%`}
          hint="Completed vs failed"
          icon={<TrendingUp className="h-4 w-4" />}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            Status Breakdown
          </CardTitle>
          <CardDescription>
            {summary.lastPurchaseAt
              ? `Last purchase ${format(
                  new Date(summary.lastPurchaseAt),
                  "PPp"
                )}`
              : "No purchases recorded yet"}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Badge
            variant="outline"
            className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100 border-green-300 dark:border-green-700"
          >
            <CheckCircle2 className="mr-1 h-3 w-3" />
            Complete: {summary.statusCounts.complete}
          </Badge>
          <Badge
            variant="outline"
            className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100 border-blue-300 dark:border-blue-700"
          >
            Confirmed: {summary.statusCounts.confirmed}
          </Badge>
          <Badge
            variant="outline"
            className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100 border-yellow-300 dark:border-yellow-700"
          >
            Pending: {summary.statusCounts.pending}
          </Badge>
          <Badge
            variant="outline"
            className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100 border-red-300 dark:border-red-700"
          >
            Failed: {summary.statusCounts.failed}
          </Badge>
        </CardContent>
      </Card>
    </div>
  );
}
