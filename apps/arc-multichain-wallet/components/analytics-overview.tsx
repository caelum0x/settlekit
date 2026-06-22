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

"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowDownToLine, ArrowUpRight, Activity, CheckCircle2 } from "lucide-react";
import { CHAIN_NAMES } from "@/lib/chain-config";
import type { AnalyticsResponse } from "@/app/api/analytics/route";

const formatUsdc = (value: number): string =>
  value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const formatChain = (chain: string): string => CHAIN_NAMES[chain as keyof typeof CHAIN_NAMES] ?? chain;

interface StatCardProps {
  label: string;
  value: string;
  icon: React.ReactNode;
  hint?: string;
}

function StatCard({ label, value, icon, hint }: StatCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
        <span className="text-muted-foreground">{icon}</span>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {hint ? (
          <p className="text-xs text-muted-foreground mt-1">{hint}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function AnalyticsOverview() {
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/analytics");
        if (!response.ok) {
          throw new Error(`Error: ${response.statusText}`);
        }
        const json = (await response.json()) as AnalyticsResponse;
        if (active) setData(json);
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Failed to load analytics");
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Unable to load analytics</CardTitle>
          <CardDescription className="text-red-500">{error}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.totals.transactionCount === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No activity yet</CardTitle>
          <CardDescription>
            Once you deposit or transfer USDC, your stats will appear here.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const { totals, statusBreakdown, chainBreakdown, recentActivity } = data;
  const maxActivity = Math.max(1, ...recentActivity.map((d) => d.count));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Deposited"
          value={`${formatUsdc(totals.totalDeposited)} USDC`}
          icon={<ArrowDownToLine className="h-4 w-4" />}
          hint={`${totals.depositCount} deposit${totals.depositCount === 1 ? "" : "s"}`}
        />
        <StatCard
          label="Total Transferred"
          value={`${formatUsdc(totals.totalTransferred)} USDC`}
          icon={<ArrowUpRight className="h-4 w-4" />}
          hint={`${totals.transferCount} transfer${totals.transferCount === 1 ? "" : "s"}`}
        />
        <StatCard
          label="Transactions"
          value={String(totals.transactionCount)}
          icon={<Activity className="h-4 w-4" />}
          hint="All time"
        />
        <StatCard
          label="Success Rate"
          value={`${totals.successRate}%`}
          icon={<CheckCircle2 className="h-4 w-4" />}
          hint="Of all transactions"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Volume by Chain</CardTitle>
            <CardDescription>
              USDC moved through each source chain.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {chainBreakdown.map((entry) => (
              <div
                key={entry.chain}
                className="flex items-center justify-between text-sm"
              >
                <span className="font-medium">{formatChain(entry.chain)}</span>
                <span className="flex items-center gap-3">
                  <Badge variant="secondary">{entry.count} tx</Badge>
                  <span className="font-mono text-muted-foreground">
                    {formatUsdc(entry.volume)} USDC
                  </span>
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Status Breakdown</CardTitle>
            <CardDescription>How your transactions resolved.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {statusBreakdown.map((entry) => (
              <div
                key={entry.status}
                className="flex items-center justify-between text-sm"
              >
                <span className="capitalize">{entry.status}</span>
                <Badge
                  variant={
                    entry.status === "success"
                      ? "default"
                      : entry.status === "failed"
                        ? "destructive"
                        : "secondary"
                  }
                  className={
                    entry.status === "success"
                      ? "bg-green-600 hover:bg-green-700"
                      : undefined
                  }
                >
                  {entry.count}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
          <CardDescription>Transactions over the last days.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {recentActivity.map((entry) => (
            <div key={entry.date} className="flex items-center gap-3 text-sm">
              <span className="w-24 shrink-0 text-muted-foreground">
                {entry.date}
              </span>
              <div className="flex-1 h-3 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full"
                  style={{ width: `${(entry.count / maxActivity) * 100}%` }}
                />
              </div>
              <span className="w-8 text-right font-mono">{entry.count}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
