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
import { ArrowLeft, Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { CHAIN_NAMES } from "@/lib/chain-config";

type TransactionStatus = "pending" | "success" | "failed";

interface Transaction {
  id: string;
  user_id: string;
  chain: string;
  tx_type: string;
  amount: number | null;
  tx_hash: string | null;
  gateway_wallet_address: string | null;
  destination_chain: string | null;
  status: TransactionStatus;
  reason: string | null;
  created_at: string;
}

const CHAIN_EXPLORERS: Record<string, string> = {
  arcTestnet: "https://testnet.arcscan.app/",
  baseSepolia: "https://sepolia.basescan.org/",
  avalancheFuji: "https://testnet.snowtrace.io/",
};

const formatChain = (chain: string): string =>
  CHAIN_NAMES[chain as keyof typeof CHAIN_NAMES] ?? chain;

function StatusBadge({ status }: { status: TransactionStatus }) {
  if (status === "success") {
    return (
      <Badge variant="default" className="bg-green-600 hover:bg-green-700">
        Success
      </Badge>
    );
  }
  if (status === "failed") {
    return <Badge variant="destructive">Failed</Badge>;
  }
  return <Badge variant="secondary">Pending</Badge>;
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium break-all">{children}</span>
    </div>
  );
}

interface TransactionReceiptProps {
  transactionId: string;
}

export function TransactionReceipt({ transactionId }: TransactionReceiptProps) {
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/transactions/${transactionId}`);
        if (response.status === 404) {
          throw new Error("Transaction not found");
        }
        if (!response.ok) {
          throw new Error(`Error: ${response.statusText}`);
        }
        const json = (await response.json()) as Transaction;
        if (active) setTransaction(json);
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Failed to load transaction");
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [transactionId]);

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Copied", { description: "Copied to clipboard" });
    } catch {
      toast.error("Copy Failed", { description: "Could not copy to clipboard" });
    }
  };

  const explorerLink = (tx: Transaction): string | null => {
    const chain =
      tx.tx_type === "transfer" && tx.destination_chain
        ? tx.destination_chain
        : tx.chain;
    const base = CHAIN_EXPLORERS[chain];
    if (!base || !tx.tx_hash) return null;
    return `${base}tx/${tx.tx_hash}`;
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72" />
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (error || !transaction) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Transaction unavailable</CardTitle>
          <CardDescription className="text-red-500">
            {error ?? "Transaction not found"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/dashboard/history">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to History
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const link = explorerLink(transaction);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="capitalize">
              {transaction.tx_type} Receipt
            </CardTitle>
            <CardDescription>
              {new Date(transaction.created_at).toLocaleString()}
            </CardDescription>
          </div>
          <StatusBadge status={transaction.status} />
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border bg-muted/40 p-4 mb-4 text-center">
          <p className="text-sm text-muted-foreground">Amount</p>
          <p className="text-3xl font-bold">
            {transaction.amount != null
              ? `${transaction.amount.toFixed(6)} USDC`
              : "N/A"}
          </p>
        </div>

        <Separator />

        <DetailRow label="Type">
          <span className="capitalize">{transaction.tx_type}</span>
        </DetailRow>
        <Separator />
        <DetailRow label="Source Chain">{formatChain(transaction.chain)}</DetailRow>
        {transaction.destination_chain ? (
          <>
            <Separator />
            <DetailRow label="Destination Chain">
              {formatChain(transaction.destination_chain)}
            </DetailRow>
          </>
        ) : null}
        <Separator />
        <DetailRow label="Status">
          <StatusBadge status={transaction.status} />
        </DetailRow>
        {transaction.reason ? (
          <>
            <Separator />
            <DetailRow label="Reason">{transaction.reason}</DetailRow>
          </>
        ) : null}
        {transaction.gateway_wallet_address ? (
          <>
            <Separator />
            <DetailRow label="Gateway Wallet">
              <span className="inline-flex items-center gap-2 font-mono text-xs">
                {transaction.gateway_wallet_address}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={() => copy(transaction.gateway_wallet_address!)}
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </span>
            </DetailRow>
          </>
        ) : null}
        <Separator />
        <DetailRow label="Transaction Hash">
          {transaction.tx_hash ? (
            <span className="inline-flex items-center gap-2 font-mono text-xs">
              {transaction.tx_hash}
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={() => copy(transaction.tx_hash!)}
              >
                <Copy className="h-3 w-3" />
              </Button>
            </span>
          ) : (
            <span className="text-muted-foreground">N/A</span>
          )}
        </DetailRow>

        <div className="flex flex-wrap gap-3 mt-6">
          <Button asChild variant="outline">
            <Link href="/dashboard/history">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to History
            </Link>
          </Button>
          {link ? (
            <Button asChild>
              <a href={link} target="_blank" rel="noopener noreferrer">
                View on Explorer
                <ExternalLink className="h-4 w-4 ml-2" />
              </a>
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
