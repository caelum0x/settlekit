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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { CreditsBadge } from "@/components/credits-badge";
import { AccountStats } from "@/components/account-stats";
import { DashboardNav } from "@/components/dashboard-nav";

export const metadata: Metadata = {
  title: "Account · SettleKit",
  description: "Your credit balance, lifetime spend, and purchase statistics.",
};

const ADMIN_EMAIL = "admin@admin.com";

export default async function AccountPage() {
  const supabase = await createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/auth/login");
  }

  // Account stats are a user-facing surface; admins use the admin dashboard.
  if (user.email === ADMIN_EMAIL || user.email === process.env.ADMIN_EMAIL) {
    redirect("/dashboard");
  }

  const { data: creditsData } = await supabase
    .from("credits")
    .select("credits")
    .eq("user_id", user.id)
    .single();

  const initialCredits = creditsData?.credits ?? 0;

  return (
    <div className="flex-1 w-full flex flex-col gap-8 items-start">
      <div className="w-full space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Account</h1>
          <p className="text-muted-foreground mt-2">
            Your credit balance, lifetime spend, and purchase statistics.
          </p>
        </div>
        <DashboardNav />
      </div>

      <Card className="w-full">
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Signed in account details.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">Email</span>
            <span className="font-medium break-all">{user.email}</span>
          </div>
          <Separator />
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">
              Current Credit Balance
            </span>
            <CreditsBadge initialCredits={initialCredits} userId={user.id} />
          </div>
        </CardContent>
      </Card>

      <div className="w-full">
        <AccountStats />
      </div>
    </div>
  );
}
