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
import Link from "next/link";
import { ChevronLeft, BarChart3 } from "lucide-react";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { CopyButton } from "@/components/copy-button";
import { ProfileForm } from "@/components/profile-form";
import { getExplorerUrl } from "@/lib/utils/get-explorer-url";
import type { Message } from "@/components/form-message";

export const metadata = {
  title: "Profile · Arc Pay",
};

function getInitials(name?: string | null): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function truncateAddress(address?: string | null): string {
  if (!address) return "Not set up yet";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export default async function ProfilePage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await props.searchParams;

  let message: Message | null = null;
  if (typeof searchParams.success === "string") {
    message = { success: searchParams.success };
  } else if (typeof searchParams.error === "string") {
    message = { error: searchParams.error };
  }

  const supabase = await createSupabaseServerComponentClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return redirect("/sign-in");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select()
    .eq("auth_user_id", user.id)
    .single();

  if (!profile) {
    return redirect("/sign-in");
  }

  const { data: wallets } = await supabase
    .schema("public")
    .from("wallets")
    .select()
    .eq("profile_id", profile.id);

  const arcWallet = wallets?.find((wallet) => wallet.blockchain === "ARC");
  const walletAddress = arcWallet?.wallet_address ?? null;

  const displayName: string = profile.full_name || profile.name || "";
  const email: string = profile.email || user.email || "";

  return (
    <div className="flex flex-col flex-1 h-full overflow-y-auto pb-4">
      <div className="sticky top-0 bg-background z-10 pb-2 mb-4 flex items-center">
        <Button asChild variant="ghost" size="icon" className="mr-2">
          <Link href="/dashboard" aria-label="Back to dashboard">
            <ChevronLeft className="h-5 w-5" />
          </Link>
        </Button>
        <h2 className="text-lg font-bold">Profile</h2>
      </div>

      <div className="flex flex-col items-center mb-6">
        <Avatar className="h-20 w-20 mb-3">
          <AvatarFallback className="text-xl font-semibold bg-primary text-primary-foreground">
            {getInitials(displayName)}
          </AvatarFallback>
        </Avatar>
        <p className="text-xl font-semibold">{displayName || "Your name"}</p>
        {profile.username && (
          <p className="text-sm text-muted-foreground">@{profile.username}</p>
        )}
      </div>

      <Card className="w-full mb-4">
        <CardHeader>
          <CardTitle className="text-base">Wallet</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <div className="text-sm font-medium mb-1">Arc address</div>
            <div className="flex items-center justify-between bg-muted p-3 rounded-md gap-2">
              <code className="text-xs font-mono break-all">
                {walletAddress ?? "Not set up yet"}
              </code>
              {walletAddress && <CopyButton text={walletAddress} />}
            </div>
          </div>
          {walletAddress && (
            <Button variant="outline" size="sm" asChild className="w-full">
              <a
                href={getExplorerUrl(walletAddress)}
                target="_blank"
                rel="noopener noreferrer"
              >
                View on ArcScan
              </a>
            </Button>
          )}
          {!walletAddress && (
            <p className="text-xs text-muted-foreground">
              {truncateAddress(walletAddress)}
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="w-full mb-4">
        <CardHeader>
          <CardTitle className="text-base">Account details</CardTitle>
        </CardHeader>
        <CardContent>
          <ProfileForm
            fullName={displayName}
            username={profile.username || ""}
            companyName={profile.company_name || ""}
            email={email}
            message={message}
          />
        </CardContent>
      </Card>

      <Button asChild variant="outline" className="w-full gap-2">
        <Link href="/dashboard/activity">
          <BarChart3 className="h-4 w-4" />
          View activity &amp; insights
        </Link>
      </Button>
    </div>
  );
}
