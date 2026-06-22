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

import { Metadata } from "next"
import { notFound } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { BackButton } from "@/components/back-button"
import { ReceiptActions } from "@/components/receipt-actions"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import {
  formatTransactionDetails,
  formatAmount,
  formatDate,
  type TransactionDetails,
} from "@/lib/utils/data-formatters"
import { BLOCK_EXPLORERS } from "@/lib/constants/block-explorers"

export const metadata: Metadata = {
  title: "Transaction Receipt",
  description: "A printable receipt for a treasury transaction.",
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  CONFIRMED: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  COMPLETE: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  FAILED: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
}

function explorerTxUrl(blockchain: string, hash?: string) {
  if (!hash) return null
  const base = BLOCK_EXPLORERS[blockchain]
  if (!base) return null
  return `${base}/tx/${hash}`
}

async function getTransaction(id: string): Promise<TransactionDetails> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    notFound()
  }

  const txId = id.startsWith("tx-") ? id.slice(3) : id

  const { data, error } = await supabase
    .from("transactions")
    .select("*")
    .eq("user_id", user.id)
    .eq("id", txId)
    .single()

  if (error || !data) {
    notFound()
  }

  return formatTransactionDetails(data)
}

function ReceiptRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-medium break-all">{value}</span>
    </div>
  )
}

export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const transaction = await getTransaction(id)

  const statusClass =
    STATUS_COLORS[transaction.status] ||
    "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400"
  const txUrl = explorerTxUrl(transaction.blockchain, transaction.tx_hash)

  return (
    <div className="mx-auto max-w-xl px-4 py-6 lg:py-8 print:max-w-none">
      <div className="mb-6 flex items-center justify-between print:hidden">
        <BackButton />
        <ReceiptActions transactionId={transaction.id} />
      </div>

      <Card className="print:border-0 print:shadow-none">
        <CardContent className="space-y-6 p-6 print:p-0">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <p className="bg-gradient-to-r from-blue-600 to-amber-600 bg-clip-text text-lg font-bold text-transparent">
                Circle Fintech Starter
              </p>
              <p className="text-xs text-muted-foreground">Transaction Receipt</p>
            </div>
            <Badge className={statusClass}>{transaction.status}</Badge>
          </div>

          <Separator />

          {/* Amount */}
          <div className="text-center">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {transaction.type === "INBOUND" ? "Amount received" : "Amount sent"}
            </p>
            <p className="text-3xl font-bold">{formatAmount(transaction.amount)}</p>
          </div>

          <Separator />

          {/* Details */}
          <div className="divide-y">
            <ReceiptRow
              label="Transaction ID"
              value={<code className="font-mono text-xs">{transaction.id}</code>}
            />
            <ReceiptRow label="Type" value={transaction.type} />
            <ReceiptRow
              label="Blockchain"
              value={<Badge variant="outline">{transaction.blockchain}</Badge>}
            />
            <ReceiptRow
              label="From"
              value={
                <code className="font-mono text-xs">
                  {transaction.sender_address || "—"}
                </code>
              }
            />
            <ReceiptRow
              label="To"
              value={
                <code className="font-mono text-xs">
                  {transaction.recipient_address || "—"}
                </code>
              }
            />
            {transaction.tx_hash && (
              <ReceiptRow
                label="Transaction hash"
                value={
                  txUrl ? (
                    <a
                      href={txUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-xs text-primary hover:underline"
                    >
                      {transaction.tx_hash}
                    </a>
                  ) : (
                    <code className="font-mono text-xs">{transaction.tx_hash}</code>
                  )
                }
              />
            )}
            <ReceiptRow label="Created" value={formatDate(transaction.created_at)} />
            {transaction.updated_at && (
              <ReceiptRow
                label="Last updated"
                value={formatDate(transaction.updated_at)}
              />
            )}
          </div>

          <Separator />

          <p className="text-center text-[11px] text-muted-foreground">
            This receipt is generated for testnet activity and is for record-keeping
            purposes only.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
