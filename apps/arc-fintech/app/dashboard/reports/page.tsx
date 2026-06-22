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

"use client"

import * as React from "react"
import {
  IconArrowDown,
  IconArrowUp,
  IconChartBar,
  IconCircleCheck,
  IconClock,
  IconAlertTriangle,
  IconReportMoney,
} from "@tabler/icons-react"
import { toast } from "sonner"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { BLOCK_EXPLORERS } from "@/lib/constants/block-explorers"

type ChainStat = {
  blockchain: string
  count: number
  volume: number
}

type Counterparty = {
  address: string
  count: number
  volume: number
}

type ReportSummary = {
  range: string
  days: number
  generatedAt: string
  totals: {
    totalVolume: number
    inflowVolume: number
    outflowVolume: number
    depositVolume: number
    totalTransactions: number
    completed: number
    pending: number
    failed: number
    successRate: number
    walletCount: number
  }
  byStatus: Record<string, number>
  chainBreakdown: ChainStat[]
  topCounterparties: Counterparty[]
}

const RANGE_OPTIONS = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "all", label: "All time" },
]

function formatUsd(value: number) {
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function shortenAddress(address: string) {
  if (!address) return ""
  if (address.length < 10) return address
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function getExplorerUrl(blockchain: string, address: string) {
  const baseUrl = BLOCK_EXPLORERS[blockchain]
  if (!baseUrl) return "#"
  return `${baseUrl}/address/${address}`
}

export default function ReportsPage() {
  const [range, setRange] = React.useState("30d")
  const [data, setData] = React.useState<ReportSummary | null>(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    let active = true
    const fetchSummary = async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/reports/summary?range=${range}`)
        if (!res.ok) throw new Error("Request failed")
        const json = (await res.json()) as ReportSummary
        if (active) setData(json)
      } catch (error) {
        console.error("Failed to load reports:", error)
        toast.error("Failed to load treasury report")
        if (active) setData(null)
      } finally {
        if (active) setLoading(false)
      }
    }
    fetchSummary()
    return () => {
      active = false
    }
  }, [range])

  const totals = data?.totals
  const maxChainVolume = React.useMemo(() => {
    if (!data) return 0
    return data.chainBreakdown.reduce((max, c) => Math.max(max, c.volume), 0)
  }, [data])

  const summaryCards = [
    {
      key: "volume",
      label: "Total Volume",
      icon: IconReportMoney,
      value: totals ? formatUsd(totals.totalVolume) : null,
      sub: totals ? `${totals.totalTransactions} transactions` : "",
    },
    {
      key: "inflow",
      label: "Inflow",
      icon: IconArrowDown,
      value: totals ? formatUsd(totals.inflowVolume) : null,
      sub: "Received into treasury",
      accent: "text-green-600 dark:text-green-400",
    },
    {
      key: "outflow",
      label: "Outflow",
      icon: IconArrowUp,
      value: totals ? formatUsd(totals.outflowVolume) : null,
      sub: "Sent from treasury",
      accent: "text-blue-600 dark:text-blue-400",
    },
    {
      key: "success",
      label: "Settlement Rate",
      icon: IconCircleCheck,
      value: totals ? `${totals.successRate}%` : null,
      sub: totals ? `${totals.completed} settled` : "",
    },
  ]

  return (
    <div className="flex flex-col gap-6 p-4 lg:p-6">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-medium tracking-tight">
            <IconChartBar className="size-5" />
            Treasury Reports
          </h2>
          <p className="text-sm text-muted-foreground">
            Aggregated volume, settlement and counterparty analytics.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={range} onValueChange={setRange}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {summaryCards.map((card) => (
          <Card key={card.key}>
            <CardHeader>
              <CardDescription className="flex items-center gap-2">
                <card.icon className="size-4" />
                {card.label}
              </CardDescription>
              <CardTitle className="text-2xl font-semibold tabular-nums">
                {loading || card.value === null ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <span className={card.accent}>{card.value}</span>
                )}
              </CardTitle>
            </CardHeader>
            {card.sub && !loading && (
              <CardContent className="pt-0 text-xs text-muted-foreground">
                {card.sub}
              </CardContent>
            )}
          </Card>
        ))}
      </div>

      {/* Status breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Transaction status</CardTitle>
          <CardDescription>
            Distribution of transaction outcomes for the selected period.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="flex items-center gap-3 rounded-lg border p-3">
                <div className="flex size-9 items-center justify-center rounded-lg bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                  <IconCircleCheck className="size-4" />
                </div>
                <div>
                  <div className="text-lg font-semibold">{totals?.completed ?? 0}</div>
                  <div className="text-xs text-muted-foreground">Settled</div>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-lg border p-3">
                <div className="flex size-9 items-center justify-center rounded-lg bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
                  <IconClock className="size-4" />
                </div>
                <div>
                  <div className="text-lg font-semibold">{totals?.pending ?? 0}</div>
                  <div className="text-xs text-muted-foreground">Pending</div>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-lg border p-3">
                <div className="flex size-9 items-center justify-center rounded-lg bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                  <IconAlertTriangle className="size-4" />
                </div>
                <div>
                  <div className="text-lg font-semibold">{totals?.failed ?? 0}</div>
                  <div className="text-xs text-muted-foreground">Failed</div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Chain breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Volume by chain</CardTitle>
          <CardDescription>
            How treasury volume is distributed across supported chains.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : !data || data.chainBreakdown.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-10 text-center">
              <IconChartBar className="size-8 text-muted-foreground" />
              <p className="text-sm font-medium">No transaction volume yet</p>
              <p className="text-xs text-muted-foreground">
                Volume by chain appears here once you transact.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {data.chainBreakdown.map((chain) => (
                <div key={chain.blockchain} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="font-normal">
                        {chain.blockchain}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {chain.count} tx
                      </span>
                    </div>
                    <span className="font-medium tabular-nums">
                      {formatUsd(chain.volume)}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{
                        width: `${
                          maxChainVolume > 0
                            ? Math.max(4, (chain.volume / maxChainVolume) * 100)
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Top counterparties */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Top counterparties</CardTitle>
          <CardDescription>
            External addresses ranked by volume settled with them.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-32 w-full" />
          ) : !data || data.topCounterparties.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              No external counterparties for this period.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Address</TableHead>
                  <TableHead className="text-right">Transactions</TableHead>
                  <TableHead className="text-right">Volume</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.topCounterparties.map((cp) => (
                  <TableRow key={cp.address}>
                    <TableCell>
                      <a
                        href={getExplorerUrl(
                          data.chainBreakdown[0]?.blockchain || "",
                          cp.address
                        )}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-sm text-muted-foreground hover:text-primary hover:underline transition-colors"
                      >
                        {shortenAddress(cp.address)}
                      </a>
                    </TableCell>
                    <TableCell className="text-right">{cp.count}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatUsd(cp.volume)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {data && !loading && (
        <>
          <Separator />
          <p className="text-xs text-muted-foreground">
            Report generated {new Date(data.generatedAt).toLocaleString("en-US")} •{" "}
            {totals?.walletCount ?? 0} wallets tracked.
          </p>
        </>
      )}
    </div>
  )
}
