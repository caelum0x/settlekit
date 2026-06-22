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

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

const GATEWAY_ADDRESS = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9"

type TransactionRow = {
  id: string
  amount: number | null
  sender_address: string | null
  recipient_address: string | null
  created_at: string
  status: string | null
  type: string | null
  blockchain: string | null
}

type WalletRow = {
  address: string | null
  blockchain: string | null
}

/**
 * Returns the number of whole days a "range" query parameter maps to.
 * Falls back to 30 days for any unrecognized value.
 */
function rangeToDays(range: string | null): number {
  switch (range) {
    case "7d":
      return 7
    case "30d":
      return 30
    case "90d":
      return 90
    case "all":
      return 36500
    default:
      return 30
  }
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const range = req.nextUrl.searchParams.get("range")
    const days = rangeToDays(range)
    const since = new Date()
    since.setDate(since.getDate() - days)

    const [{ data: txData, error: txError }, { data: walletData, error: walletError }] =
      await Promise.all([
        supabase
          .from("transactions")
          .select("*")
          .eq("user_id", user.id)
          .gte("created_at", since.toISOString())
          .order("created_at", { ascending: false }),
        supabase
          .from("wallets")
          .select("address, blockchain")
          .eq("user_id", user.id),
      ])

    if (txError) throw txError
    if (walletError) throw walletError

    const transactions = (txData || []) as TransactionRow[]
    const wallets = (walletData || []) as WalletRow[]

    const internalAddresses = new Set(
      wallets.map((w) => (w.address ?? "").toLowerCase()).filter(Boolean)
    )

    let totalVolume = 0
    let inflowVolume = 0
    let outflowVolume = 0
    let depositVolume = 0
    let completed = 0
    let pending = 0
    let failed = 0

    const byChain: Record<string, { count: number; volume: number }> = {}
    const byStatus: Record<string, number> = {}
    const counterparties: Record<string, { count: number; volume: number }> = {}

    for (const tx of transactions) {
      const amount = Number(tx.amount ?? 0)
      totalVolume += amount

      const status = (tx.status ?? "UNKNOWN").toUpperCase()
      byStatus[status] = (byStatus[status] || 0) + 1
      if (status === "COMPLETE" || status === "CONFIRMED") completed += 1
      else if (status === "PENDING") pending += 1
      else if (status === "FAILED") failed += 1

      const chain = tx.blockchain ?? "UNKNOWN"
      if (!byChain[chain]) byChain[chain] = { count: 0, volume: 0 }
      byChain[chain].count += 1
      byChain[chain].volume += amount

      const recipient = (tx.recipient_address ?? "").toLowerCase()
      const sender = (tx.sender_address ?? "").toLowerCase()
      const isDeposit = recipient === GATEWAY_ADDRESS.toLowerCase()

      if (isDeposit) {
        depositVolume += amount
      } else if (tx.type === "INBOUND") {
        inflowVolume += amount
      } else {
        outflowVolume += amount
      }

      // Track external counterparties (addresses not owned by this user)
      const external = !internalAddresses.has(recipient) && !isDeposit ? recipient : null
      if (external) {
        if (!counterparties[external]) counterparties[external] = { count: 0, volume: 0 }
        counterparties[external].count += 1
        counterparties[external].volume += amount
      }
    }

    const totalTransactions = transactions.length
    const settledCount = completed
    const successRate =
      totalTransactions > 0 ? Math.round((settledCount / totalTransactions) * 100) : 0

    const topCounterparties = Object.entries(counterparties)
      .map(([address, stats]) => ({ address, ...stats }))
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 5)

    const chainBreakdown = Object.entries(byChain)
      .map(([blockchain, stats]) => ({ blockchain, ...stats }))
      .sort((a, b) => b.volume - a.volume)

    return NextResponse.json({
      range: range || "30d",
      days,
      generatedAt: new Date().toISOString(),
      totals: {
        totalVolume,
        inflowVolume,
        outflowVolume,
        depositVolume,
        totalTransactions,
        completed,
        pending,
        failed,
        successRate,
        walletCount: wallets.length,
      },
      byStatus,
      chainBreakdown,
      topCounterparties,
    })
  } catch (error) {
    console.error("Reports summary error:", error)
    return NextResponse.json(
      { error: "Failed to build reports summary" },
      { status: 500 }
    )
  }
}
