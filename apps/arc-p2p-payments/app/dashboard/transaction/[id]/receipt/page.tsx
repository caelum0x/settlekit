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
import { useParams } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, CheckCircle2, Clock, XCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/copy-button";

const baseUrl = process.env.NEXT_PUBLIC_VERCEL_URL
  ? process.env.NEXT_PUBLIC_VERCEL_URL
  : "http://localhost:3000";

interface ReceiptTransaction {
  id: string;
  amounts?: string[];
  state?: string;
  createDate?: string;
  updateDate?: string;
  transactionType?: string;
  from?: string;
  to?: string;
  txHash?: string;
  networkName?: string;
}

function truncate(value?: string): string {
  if (!value || value === "Unknown") return "Unknown";
  if (value.length <= 14) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function StatusBadge({ state }: { state?: string }) {
  const status = (state || "").toLowerCase();
  if (status === "complete") {
    return (
      <span className="inline-flex items-center gap-1 text-green-600 font-medium">
        <CheckCircle2 className="h-5 w-5" /> Complete
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span className="inline-flex items-center gap-1 text-yellow-600 font-medium">
        <Clock className="h-5 w-5" /> Pending
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1 text-red-600 font-medium">
        <XCircle className="h-5 w-5" /> Failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground font-medium">
      {state?.toUpperCase() || "Unknown"}
    </span>
  );
}

export default function ReceiptPage() {
  const params = useParams();
  const id = params.id as string;

  const [transaction, setTransaction] = useState<ReceiptTransaction | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchTransaction() {
      if (!id) return;
      try {
        setLoading(true);
        const response = await fetch(
          `${baseUrl}/api/wallet/transactions/${id}`,
        );
        const parsed = await response.json();
        if (parsed.error) {
          setError(parsed.error);
          return;
        }
        setTransaction(parsed.transaction);
      } catch (err) {
        console.error("Error fetching receipt:", err);
        setError("Failed to load receipt");
      } finally {
        setLoading(false);
      }
    }

    fetchTransaction();
  }, [id]);

  if (loading) {
    return (
      <div className="p-4">
        <Skeleton className="h-8 w-1/2 mb-6" />
        <Skeleton className="h-40 w-full rounded-xl mb-4" />
        <Skeleton className="h-6 w-full mb-2" />
        <Skeleton className="h-6 w-full mb-2" />
      </div>
    );
  }

  if (error || !transaction) {
    return (
      <div className="flex flex-col p-4 h-full">
        <div className="sticky top-0 bg-background z-10 pb-2 mb-4 flex items-center">
          <Button asChild variant="ghost" size="icon" className="mr-2">
            <Link href="/dashboard" aria-label="Back to dashboard">
              <ChevronLeft className="h-5 w-5" />
            </Link>
          </Button>
          <h2 className="text-lg font-bold">Receipt</h2>
        </div>
        <div className="p-4 border border-red-300 bg-red-50 rounded-md text-red-700">
          {error || "Receipt not available"}
        </div>
      </div>
    );
  }

  const amount =
    transaction.amounts && transaction.amounts[0]
      ? parseFloat(transaction.amounts[0]).toFixed(2)
      : "0.00";

  const isReceived =
    (transaction.transactionType || "").includes("in") ||
    (transaction.transactionType || "").includes("received");

  const created = transaction.createDate
    ? new Date(transaction.createDate)
    : null;

  return (
    <div className="flex flex-col p-4 h-full overflow-y-auto">
      <div className="sticky top-0 bg-background z-10 pb-2 mb-4 flex items-center">
        <Button asChild variant="ghost" size="icon" className="mr-2">
          <Link
            href={`/dashboard/transaction/${id}`}
            aria-label="Back to transaction details"
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
        </Button>
        <h2 className="text-lg font-bold">Receipt</h2>
      </div>

      {/* Receipt card */}
      <div className="rounded-xl border bg-card p-6 text-center mb-4">
        <p className="text-sm text-muted-foreground mb-1">
          {isReceived ? "Payment received" : "Payment sent"}
        </p>
        <p className="text-4xl font-bold mb-2">
          {isReceived ? "+" : "-"}${amount}
        </p>
        <p className="text-xs text-muted-foreground mb-4">USDC</p>
        <StatusBadge state={transaction.state} />
        {created && (
          <p className="text-xs text-muted-foreground mt-4">
            {created.toLocaleDateString()} · {created.toLocaleTimeString()}
          </p>
        )}
      </div>

      {/* Details */}
      <div className="space-y-3 text-sm">
        <div className="flex justify-between items-center gap-2">
          <span className="text-muted-foreground">From</span>
          <span className="flex items-center gap-2 font-mono">
            {truncate(transaction.from)}
          </span>
        </div>
        <div className="flex justify-between items-center gap-2">
          <span className="text-muted-foreground">To</span>
          <span className="flex items-center gap-2 font-mono">
            {truncate(transaction.to)}
          </span>
        </div>
        <div className="flex justify-between items-center gap-2">
          <span className="text-muted-foreground">Network</span>
          <span>{transaction.networkName || "Arc Testnet"}</span>
        </div>
        {transaction.txHash && (
          <div className="flex justify-between items-center gap-2">
            <span className="text-muted-foreground">Tx hash</span>
            <span className="flex items-center gap-2 font-mono">
              {truncate(transaction.txHash)}
              <CopyButton text={transaction.txHash} />
            </span>
          </div>
        )}
      </div>

      {transaction.txHash && (
        <Button variant="outline" asChild className="w-full mt-6">
          <a
            href={`https://testnet.arcscan.app/tx/${transaction.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            View on ArcScan
          </a>
        </Button>
      )}
    </div>
  );
}
