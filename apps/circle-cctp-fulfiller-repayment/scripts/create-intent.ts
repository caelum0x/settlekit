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

import { env, intentDefaults } from "../src/config/env.js";
import { createIntentId, parseUsdcAmount } from "../src/lib/cctp.js";
import { appendIntent, logStep } from "../src/lib/runtime.js";
import type { IntentRecord } from "../src/lib/types.js";

type IntentInput = {
  amountUsdc: string;
  priority: "fast" | "cheap";
  maxFeeBps: number;
  recipient: `0x${string}`;
};

function getArgValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function getIntentInput(): IntentInput {
  const amountUsdc = getArgValue("--amount") ?? intentDefaults.amountUsdc;
  const priorityArg = getArgValue("--priority");
  const priority =
    priorityArg === "cheap" || priorityArg === "fast"
      ? priorityArg
      : intentDefaults.priority;
  const maxFeeBpsValue = getArgValue("--max-fee-bps");
  const maxFeeBps = maxFeeBpsValue
    ? Number(maxFeeBpsValue)
    : intentDefaults.maxFeeBps;
  const recipient = (getArgValue("--recipient") ??
    env.recipientAddress) as `0x${string}`;

  return { amountUsdc, priority, maxFeeBps, recipient };
}

async function main(): Promise<void> {
  const intent = getIntentInput();
  const amount = parseUsdcAmount(intent.amountUsdc);
  // The intent stays intentionally small so changing one field can pick a different fulfiller.
  const intentId = createIntentId(intent.recipient, amount, intent.priority);
  const record: IntentRecord = {
    intentId,
    recipient: intent.recipient,
    amountUsdc: intent.amountUsdc,
    priority: intent.priority,
    maxFeeBps: intent.maxFeeBps,
    status: "intent_created",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    logs: [`Intent created for ${intent.amountUsdc} USDC with priority=${intent.priority}`],
  };
  await appendIntent(record);
  logStep("intent", `Created intent ${intentId}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
