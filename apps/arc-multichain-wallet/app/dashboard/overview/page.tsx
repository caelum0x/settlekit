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
import { createClient } from "@/lib/supabase/server";
import { AnalyticsOverview } from "@/components/analytics-overview";

export const metadata = {
  title: "Overview | Arc Multichain Wallet",
  description: "Account-wide stats for your deposits and cross-chain transfers.",
};

export default async function OverviewPage() {
  const supabase = await createClient();

  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) {
    redirect("/auth/login");
  }

  return (
    <div className="flex-1 flex flex-col gap-6 max-w-7xl p-5 mx-auto w-full">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold">Overview</h1>
        <p className="text-muted-foreground">
          A summary of your deposit and cross-chain transfer activity.
        </p>
      </div>
      <AnalyticsOverview />
    </div>
  );
}
