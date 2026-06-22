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
import { PREMIUM_ENDPOINTS } from "@/lib/endpoints";

export const dynamic = "force-dynamic";

type PaymentRow = {
  created_at: string;
  endpoint: string;
  payer: string;
  amount_usdc: string;
};

export interface EndpointBreakdown {
  path: string;
  name: string;
  price: string;
  count: number;
  revenue: number;
}

export interface DailyPoint {
  date: string;
  count: number;
  revenue: number;
}

export interface StatsResponse {
  totalRevenue: number;
  totalPayments: number;
  uniquePayers: number;
  avgPayment: number;
  last24hRevenue: number;
  last24hCount: number;
  topEndpoint: EndpointBreakdown | null;
  byEndpoint: EndpointBreakdown[];
  daily: DailyPoint[];
}

function safeAmount(value: string): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function dayKey(iso: string): string {
  return iso.slice(0, 10); // YYYY-MM-DD
}

export async function GET() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("payment_events")
    .select("created_at, endpoint, payer, amount_usdc")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to load payment events for stats:", error.message);
    return NextResponse.json(
      { error: "Failed to load stats" },
      { status: 500 },
    );
  }

  const rows = (data ?? []) as PaymentRow[];

  const nameByPath = new Map(PREMIUM_ENDPOINTS.map((e) => [e.path, e.name]));
  const priceByPath = new Map(PREMIUM_ENDPOINTS.map((e) => [e.path, e.price]));

  const endpointMap = new Map<string, EndpointBreakdown>();
  const payers = new Set<string>();
  const dailyMap = new Map<string, DailyPoint>();

  let totalRevenue = 0;
  let last24hRevenue = 0;
  let last24hCount = 0;
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;

  for (const row of rows) {
    const amount = safeAmount(row.amount_usdc);
    totalRevenue += amount;
    payers.add(row.payer);

    const existing = endpointMap.get(row.endpoint);
    if (existing) {
      endpointMap.set(row.endpoint, {
        ...existing,
        count: existing.count + 1,
        revenue: existing.revenue + amount,
      });
    } else {
      endpointMap.set(row.endpoint, {
        path: row.endpoint,
        name: nameByPath.get(row.endpoint) ?? row.endpoint,
        price: priceByPath.get(row.endpoint) ?? "—",
        count: 1,
        revenue: amount,
      });
    }

    const key = dayKey(row.created_at);
    const point = dailyMap.get(key);
    if (point) {
      dailyMap.set(key, {
        ...point,
        count: point.count + 1,
        revenue: point.revenue + amount,
      });
    } else {
      dailyMap.set(key, { date: key, count: 1, revenue: amount });
    }

    if (new Date(row.created_at).getTime() >= cutoff) {
      last24hRevenue += amount;
      last24hCount += 1;
    }
  }

  const byEndpoint = [...endpointMap.values()].sort(
    (a, b) => b.revenue - a.revenue,
  );

  const daily = [...dailyMap.values()].sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  const totalPayments = rows.length;
  const stats: StatsResponse = {
    totalRevenue,
    totalPayments,
    uniquePayers: payers.size,
    avgPayment: totalPayments > 0 ? totalRevenue / totalPayments : 0,
    last24hRevenue,
    last24hCount,
    topEndpoint: byEndpoint[0] ?? null,
    byEndpoint,
    daily,
  };

  return NextResponse.json(stats);
}
