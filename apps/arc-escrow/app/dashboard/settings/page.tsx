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

import Link from "next/link";
import { redirect } from "next/navigation";

import { createSupabaseServerComponentClient } from "@/lib/supabase/server-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SubmitButton } from "@/components/submit-button";
import { FormMessage, type Message } from "@/components/form-message";
import { CopyButton } from "@/components/copy-button";
import { updateProfileAction } from "./actions";

export const metadata = {
  title: "Settings · Escrow Refund Protocol",
  description: "Manage your profile details and wallet information.",
};

function hasMessage(searchParams: Message): boolean {
  return (
    "success" in searchParams ||
    "error" in searchParams ||
    "message" in searchParams
  );
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Message>;
}) {
  const resolvedSearchParams = await searchParams;
  const supabase = createSupabaseServerComponentClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return redirect("/sign-in");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, company_name, email")
    .eq("auth_user_id", user.id)
    .single();

  const { data: wallet } = await supabase
    .from("wallets")
    .select("wallet_address, circle_wallet_id, blockchain")
    .eq("profile_id", profile?.id)
    .single();

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <h2 className="scroll-m-20 text-3xl font-semibold tracking-tight">
          Settings
        </h2>
        <Button asChild variant="outline">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      </div>

      <div className="flex flex-col gap-4 max-w-2xl">
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Profile</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={updateProfileAction} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  value={profile?.email ?? user.email ?? ""}
                  disabled
                  readOnly
                />
                <p className="text-xs text-muted-foreground">
                  Email is managed through your sign-in credentials.
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="full-name">Full name</Label>
                <Input
                  id="full-name"
                  name="full-name"
                  type="text"
                  placeholder="Jane Doe"
                  defaultValue={profile?.full_name ?? ""}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="company-name">Company name</Label>
                <Input
                  id="company-name"
                  name="company-name"
                  type="text"
                  placeholder="Acme Inc."
                  defaultValue={profile?.company_name ?? ""}
                />
              </div>

              <div className="flex flex-col gap-2">
                <SubmitButton
                  pendingText="Saving..."
                  className="self-start"
                >
                  Save changes
                </SubmitButton>
                {hasMessage(resolvedSearchParams) && (
                  <FormMessage message={resolvedSearchParams} />
                )}
              </div>
            </form>
          </CardContent>
        </Card>

        <Card className="w-full">
          <CardHeader>
            <CardTitle>Wallet</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {wallet ? (
              <>
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-muted-foreground">
                    Wallet address
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm break-all">
                      {wallet.wallet_address}
                    </span>
                    <CopyButton text={wallet.wallet_address} />
                  </div>
                </div>
                <Separator />
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-muted-foreground">
                    Blockchain
                  </span>
                  <span className="text-sm">{wallet.blockchain ?? "—"}</span>
                </div>
              </>
            ) : (
              <p className="text-muted-foreground">
                No wallet is associated with your account yet.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
