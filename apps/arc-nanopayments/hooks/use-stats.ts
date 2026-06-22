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

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { StatsResponse } from "@/app/api/stats/route";

export type { StatsResponse } from "@/app/api/stats/route";

/**
 * Loads aggregated seller stats from /api/stats and re-fetches whenever a new
 * payment is settled (via the same Supabase realtime channel pattern used by
 * the transaction hooks).
 */
export function useStats() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/stats", { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`Request failed with status ${res.status}`);
      }
      const data = (await res.json()) as StatsResponse;
      setStats(data);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load stats";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("stats-refresh")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "payment_events" },
        () => {
          fetchStats();
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          fetchStats();
        }
      });

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchStats]);

  return { stats, loading, error, refresh: fetchStats };
}
