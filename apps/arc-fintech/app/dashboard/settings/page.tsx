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
import Link from "next/link"
import { User } from "@supabase/supabase-js"
import {
  IconUserCircle,
  IconSettings,
  IconBell,
  IconCopy,
  IconShieldLock,
  IconRefresh,
} from "@tabler/icons-react"
import { toast } from "sonner"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { createClient } from "@/lib/supabase/client"
import {
  usePreferences,
  type ChainPreference,
} from "@/hooks/use-preferences"

const CHAIN_OPTIONS: { value: ChainPreference; label: string }[] = [
  { value: "ARC-TESTNET", label: "Arc Testnet" },
  { value: "ETH-SEPOLIA", label: "Ethereum Sepolia" },
  { value: "BASE-SEPOLIA", label: "Base Sepolia" },
  { value: "AVAX-FUJI", label: "Avalanche Fuji" },
]

function formatDate(value?: string) {
  if (!value) return "—"
  try {
    return new Date(value).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "numeric",
    })
  } catch {
    return value
  }
}

export default function SettingsPage() {
  const [user, setUser] = React.useState<User | null>(null)
  const [loading, setLoading] = React.useState(true)
  const { preferences, loaded, update, reset } = usePreferences()

  const supabase = createClient()

  React.useEffect(() => {
    const fetchUser = async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()
        setUser(user)
      } catch (error) {
        console.error("Error loading user:", error)
        toast.error("Failed to load account details")
      } finally {
        setLoading(false)
      }
    }
    fetchUser()
  }, [supabase])

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text)
    toast.success(`${label} copied to clipboard`)
  }

  const email = user?.email || ""
  const [nameFromEmail] = email.split("@")
  const initials = (nameFromEmail || "U").slice(0, 2).toUpperCase()

  return (
    <div className="flex flex-col gap-6 p-4 lg:p-6">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-medium tracking-tight">
          <IconSettings className="size-5" />
          Settings
        </h2>
        <p className="text-sm text-muted-foreground">
          Manage your account, preferences and notifications.
        </p>
      </div>

      {/* Account */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <IconUserCircle className="size-4" />
            Account
          </CardTitle>
          <CardDescription>Your account identity and session.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {loading ? (
            <div className="flex items-center gap-4">
              <Skeleton className="size-14 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-56" />
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-4">
              <Avatar className="size-14">
                <AvatarImage
                  src={user?.user_metadata?.avatar_url || ""}
                  alt={nameFromEmail}
                />
                <AvatarFallback className="text-lg">{initials}</AvatarFallback>
              </Avatar>
              <div className="space-y-1">
                <p className="text-sm font-medium capitalize">{nameFromEmail}</p>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{email}</span>
                  {email && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      onClick={() => copyToClipboard(email, "Email")}
                    >
                      <IconCopy className="size-3" />
                      <span className="sr-only">Copy email</span>
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}

          {!loading && user && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">User ID</p>
                <div className="flex items-center gap-2">
                  <code className="font-mono text-xs">
                    {user.id.slice(0, 8)}…{user.id.slice(-6)}
                  </code>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    onClick={() => copyToClipboard(user.id, "User ID")}
                  >
                    <IconCopy className="size-3" />
                    <span className="sr-only">Copy user ID</span>
                  </Button>
                </div>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Last sign in</p>
                <p className="text-sm">{formatDate(user.last_sign_in_at)}</p>
              </div>
            </div>
          )}

          <Separator />

          <div className="flex flex-wrap items-center gap-3">
            <Button asChild variant="outline" size="sm">
              <Link href="/auth/update-password">
                <IconShieldLock className="size-4" />
                Change password
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Preferences */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <IconSettings className="size-4" />
            Preferences
          </CardTitle>
          <CardDescription>
            Defaults applied across the treasury dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-col gap-2 sm:max-w-xs">
            <Label htmlFor="default-chain">Default chain</Label>
            {loaded ? (
              <Select
                value={preferences.defaultChain}
                onValueChange={(value) =>
                  update("defaultChain", value as ChainPreference)
                }
              >
                <SelectTrigger id="default-chain">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHAIN_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Skeleton className="h-9 w-full" />
            )}
            <p className="text-xs text-muted-foreground">
              Pre-selected when creating wallets or sending funds.
            </p>
          </div>

          <Separator />

          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Compact tables</p>
              <p className="text-xs text-muted-foreground">
                Reduce row spacing in activity and wallet lists.
              </p>
            </div>
            <Checkbox
              checked={preferences.compactTables}
              onCheckedChange={(value) =>
                update("compactTables", value === true)
              }
              disabled={!loaded}
            />
          </div>
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <IconBell className="size-4" />
            Notifications
          </CardTitle>
          <CardDescription>
            Choose which in-app toasts you want to receive.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Transfers &amp; deposits</p>
              <p className="text-xs text-muted-foreground">
                Notify me when a transaction completes.
              </p>
            </div>
            <Checkbox
              checked={preferences.notifyOnTransfer}
              onCheckedChange={(value) =>
                update("notifyOnTransfer", value === true)
              }
              disabled={!loaded}
            />
          </div>
          <Separator />
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Compliance alerts</p>
              <p className="text-xs text-muted-foreground">
                Notify me when a screening flags an address.
              </p>
            </div>
            <Checkbox
              checked={preferences.notifyOnCompliance}
              onCheckedChange={(value) =>
                update("notifyOnCompliance", value === true)
              }
              disabled={!loaded}
            />
          </div>
        </CardContent>
      </Card>

      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            reset()
            toast.success("Preferences reset to defaults")
          }}
          disabled={!loaded}
        >
          <IconRefresh className="size-4" />
          Reset preferences
        </Button>
      </div>
    </div>
  )
}
