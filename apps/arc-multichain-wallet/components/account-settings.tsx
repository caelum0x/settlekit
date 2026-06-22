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
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { LogoutButton } from "@/components/logout-button";
import { Copy, Wallet } from "lucide-react";
import { toast } from "sonner";

interface WalletRecord {
  id: string;
  wallet_address: string;
  blockchain: string | null;
  type: string | null;
  name: string | null;
  created_at: string;
}

interface AccountSettingsProps {
  email: string;
}

const WALLET_TYPE_LABELS: Record<string, string> = {
  sca: "Smart Account",
  gateway_signer: "Gateway Signer (EOA)",
};

const formatType = (type: string | null): string => {
  if (!type) return "Wallet";
  return WALLET_TYPE_LABELS[type] ?? type;
};

const truncate = (address: string): string => {
  if (!address || address.length < 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

export function AccountSettings({ email }: AccountSettingsProps) {
  const [wallets, setWallets] = useState<WalletRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/wallets");
        if (!response.ok) {
          throw new Error(`Error: ${response.statusText}`);
        }
        const json = (await response.json()) as WalletRecord[];
        if (active) setWallets(json);
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Failed to load wallets");
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

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Copied", { description: "Wallet address copied to clipboard" });
    } catch {
      toast.error("Copy Failed", { description: "Could not copy to clipboard" });
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>Your signed-in account details.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
            <span className="text-sm text-muted-foreground">Email</span>
            <span className="text-sm font-medium">{email}</span>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Sign out</span>
            <LogoutButton />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            Wallets
          </CardTitle>
          <CardDescription>
            Circle wallets associated with your account across supported chains.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : error ? (
            <p className="text-sm text-red-500">{error}</p>
          ) : wallets.length === 0 ? (
            <div className="text-center py-6 space-y-3">
              <p className="text-sm text-muted-foreground">
                No wallets yet. Set up a wallet from the dashboard to get started.
              </p>
              <Button asChild variant="outline" size="sm">
                <Link href="/dashboard">Go to Dashboard</Link>
              </Button>
            </div>
          ) : (
            <ul className="space-y-3">
              {wallets.map((wallet) => (
                <li
                  key={wallet.id}
                  className="flex items-center justify-between gap-3 rounded-md border p-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm truncate">
                        {truncate(wallet.wallet_address)}
                      </span>
                      <Badge variant="secondary">{formatType(wallet.type)}</Badge>
                    </div>
                    {wallet.blockchain ? (
                      <p className="text-xs text-muted-foreground mt-1">
                        {wallet.blockchain}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 shrink-0"
                    onClick={() => copy(wallet.wallet_address)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Choose how the app looks to you.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Theme</span>
            <ThemeSwitcher />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
