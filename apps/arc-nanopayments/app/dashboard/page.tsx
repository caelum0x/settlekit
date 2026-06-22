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

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Activity,
  ArrowRight,
  Clock,
  DollarSign,
  Loader2,
  Receipt,
  TrendingUp,
  Users,
} from "lucide-react";
import { shortenHash } from "@/lib/utils";
import { useStats } from "@/hooks/use-stats";
import { usePaymentEvents } from "@/hooks/use-transactions";

const EXPLORER_BASE = "https://testnet.arcscan.app";

function formatUsd(value: number): string {
  // USDC nanopayments can be sub-cent; show enough precision without noise.
  if (value === 0) return "$0.00";
  if (value < 0.01) return `$${value.toFixed(6)}`;
  return `$${value.toFixed(value < 1 ? 4 : 2)}`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface StatCardProps {
  label: string;
  value: string;
  hint?: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  loading: boolean;
}

function StatCard({ label, value, hint, icon: Icon, loading }: StatCardProps) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
        <Icon size={16} className="text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {loading ? (
          <Loader2 size={18} className="animate-spin text-muted-foreground" />
        ) : (
          <>
            <div className="text-2xl font-bold font-mono tabular-nums">
              {value}
            </div>
            {hint && (
              <p className="text-xs text-muted-foreground mt-1">{hint}</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function Overview() {
  const { stats, loading, error } = useStats();
  const { events, loading: loadingEvents } = usePaymentEvents();

  const recent = events.slice(0, 6);
  const maxEndpointRevenue = stats
    ? Math.max(1, ...stats.byEndpoint.map((e) => e.revenue))
    : 1;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Welcome back!</h1>
        <p className="text-muted-foreground text-sm">
          Your nanopayment business at a glance.
        </p>
      </div>

      {error && (
        <Card className="border-destructive/50">
          <CardContent className="py-4 text-sm text-destructive">
            Failed to load analytics: {error}
          </CardContent>
        </Card>
      )}

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total Revenue"
          value={formatUsd(stats?.totalRevenue ?? 0)}
          hint="USDC settled to date"
          icon={DollarSign}
          loading={loading}
        />
        <StatCard
          label="Payments"
          value={String(stats?.totalPayments ?? 0)}
          hint={`Avg ${formatUsd(stats?.avgPayment ?? 0)} / payment`}
          icon={Receipt}
          loading={loading}
        />
        <StatCard
          label="Unique Payers"
          value={String(stats?.uniquePayers ?? 0)}
          hint="Distinct buyer wallets"
          icon={Users}
          loading={loading}
        />
        <StatCard
          label="Last 24h"
          value={formatUsd(stats?.last24hRevenue ?? 0)}
          hint={`${stats?.last24hCount ?? 0} payment${(stats?.last24hCount ?? 0) === 1 ? "" : "s"}`}
          icon={Clock}
          loading={loading}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Revenue by endpoint */}
        <Card className="lg:col-span-3">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp size={16} className="text-muted-foreground" />
              Revenue by Endpoint
            </CardTitle>
            <Link
              href="/dashboard/endpoints"
              className="text-xs text-primary hover:underline inline-flex items-center gap-1"
            >
              View catalog <ArrowRight size={12} />
            </Link>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 size={16} className="animate-spin mr-2" />
                Loading...
              </div>
            ) : !stats || stats.byEndpoint.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No payments yet. Run the agent to generate revenue, then watch
                it appear here in real time.
              </div>
            ) : (
              <div className="space-y-4">
                {stats.byEndpoint.map((e) => (
                  <div key={e.path}>
                    <div className="flex items-center justify-between text-sm mb-1.5">
                      <span className="font-medium truncate">{e.name}</span>
                      <span className="font-mono text-muted-foreground shrink-0 ml-2">
                        {formatUsd(e.revenue)}
                        <span className="text-muted-foreground/60">
                          {" "}
                          · {e.count}
                        </span>
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{
                          width: `${(e.revenue / maxEndpointRevenue) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent activity feed */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity size={16} className="text-muted-foreground" />
              Recent Activity
            </CardTitle>
            <Link
              href="/dashboard/payments"
              className="text-xs text-primary hover:underline inline-flex items-center gap-1"
            >
              All <ArrowRight size={12} />
            </Link>
          </CardHeader>
          <CardContent>
            {loadingEvents ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 size={16} className="animate-spin mr-2" />
                Loading...
              </div>
            ) : recent.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No activity yet.
              </div>
            ) : (
              <ul className="divide-y">
                {recent.map((ev) => (
                  <li
                    key={ev.id}
                    className="flex items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
                  >
                    <Link
                      href={`/dashboard/payments/${ev.id}`}
                      className="min-w-0 group"
                    >
                      <div className="flex items-center gap-1.5">
                        <Badge variant="secondary" className="font-mono text-[10px]">
                          {ev.endpoint.replace("/api/premium/", "")}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 truncate">
                        {shortenHash(ev.payer)} · {timeAgo(ev.created_at)}
                      </p>
                    </Link>
                    <span className="font-mono text-sm shrink-0">
                      ${ev.amount_usdc}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {stats?.topEndpoint && (
        <p className="text-xs text-muted-foreground">
          Top earner:{" "}
          <span className="font-medium text-foreground">
            {stats.topEndpoint.name}
          </span>{" "}
          ({formatUsd(stats.topEndpoint.revenue)} across{" "}
          {stats.topEndpoint.count} payment
          {stats.topEndpoint.count === 1 ? "" : "s"}). Settlements explored on{" "}
          <a
            href={EXPLORER_BASE}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            Arcscan
          </a>
          .
        </p>
      )}
    </div>
  );
}
