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

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TransactionHistory } from "@/components/transaction-history-table";
import { DashboardNav } from "@/components/dashboard-nav";

export const metadata: Metadata = {
  title: "Transactions · SettleKit",
  description: "Full history of your USDC credit purchases on Arc.",
};

export default async function TransactionsPage() {
  const supabase = await createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/auth/login");
  }

  return (
    <div className="flex-1 w-full flex flex-col gap-8 items-start">
      <div className="w-full space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Transactions</h1>
          <p className="text-muted-foreground mt-2">
            The full history of your USDC credit purchases. Filter by date and
            sort any column.
          </p>
        </div>
        <DashboardNav />
      </div>

      <div className="w-full">
        <TransactionHistory />
      </div>
    </div>
  );
}
