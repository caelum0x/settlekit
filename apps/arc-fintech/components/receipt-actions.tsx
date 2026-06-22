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

import { IconPrinter, IconCopy } from "@tabler/icons-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"

interface ReceiptActionsProps {
  transactionId: string
}

export function ReceiptActions({ transactionId }: ReceiptActionsProps) {
  const handlePrint = () => {
    window.print()
  }

  const handleCopyId = async () => {
    try {
      await navigator.clipboard.writeText(transactionId)
      toast.success("Transaction ID copied to clipboard")
    } catch {
      toast.error("Failed to copy transaction ID")
    }
  }

  return (
    <div className="flex items-center gap-2 print:hidden">
      <Button variant="outline" size="sm" onClick={handleCopyId}>
        <IconCopy className="size-4" />
        Copy ID
      </Button>
      <Button variant="outline" size="sm" onClick={handlePrint}>
        <IconPrinter className="size-4" />
        Print
      </Button>
    </div>
  )
}
