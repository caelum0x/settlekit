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

const STORAGE_KEY = "arc-fintech:preferences"

export type ChainPreference =
  | "ARC-TESTNET"
  | "ETH-SEPOLIA"
  | "BASE-SEPOLIA"
  | "AVAX-FUJI"

export interface Preferences {
  defaultChain: ChainPreference
  notifyOnTransfer: boolean
  notifyOnCompliance: boolean
  compactTables: boolean
}

export const DEFAULT_PREFERENCES: Preferences = {
  defaultChain: "ARC-TESTNET",
  notifyOnTransfer: true,
  notifyOnCompliance: true,
  compactTables: false,
}

function readPreferences(): Preferences {
  if (typeof window === "undefined") return DEFAULT_PREFERENCES
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_PREFERENCES
    const parsed = JSON.parse(raw) as Partial<Preferences>
    return { ...DEFAULT_PREFERENCES, ...parsed }
  } catch {
    return DEFAULT_PREFERENCES
  }
}

/**
 * Persists user UI preferences to localStorage. Returns the current
 * preferences, a setter for individual keys, and a loaded flag so the
 * UI can avoid a hydration flash before the stored value is read.
 */
export function usePreferences() {
  const [preferences, setPreferences] =
    React.useState<Preferences>(DEFAULT_PREFERENCES)
  const [loaded, setLoaded] = React.useState(false)

  React.useEffect(() => {
    setPreferences(readPreferences())
    setLoaded(true)
  }, [])

  const update = React.useCallback(
    <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
      setPreferences((current) => {
        const next = { ...current, [key]: value }
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
        } catch {
          // Ignore storage write failures (e.g. private mode quota).
        }
        return next
      })
    },
    []
  )

  const reset = React.useCallback(() => {
    setPreferences(DEFAULT_PREFERENCES)
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(DEFAULT_PREFERENCES)
      )
    } catch {
      // Ignore storage write failures.
    }
  }, [])

  return { preferences, loaded, update, reset }
}
