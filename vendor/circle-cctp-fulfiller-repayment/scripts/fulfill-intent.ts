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

import { formatUnits, getAddress } from "viem";

import { parseUsdcAmount } from "../src/lib/cctp.js";
import { chooseFulfiller } from "../src/lib/flow-logic.js";
import { fulfillerProfiles } from "../src/lib/fulfillers.js";
import { fulfillPayout, registerIntentRepayment } from "../src/lib/repayment.js";
import { loadIntents, logStep, saveIntents } from "../src/lib/runtime.js";

async function main(): Promise<void> {
  const records = await loadIntents();
  const nextRecords = [];

  for (const record of records) {
    if (!["intent_created", "payout_sent"].includes(record.status)) {
      nextRecords.push(record);
      continue;
    }

    let nextRecord = { ...record };
    const amount = parseUsdcAmount(record.amountUsdc);

    if (record.status === "intent_created") {
      // This is the mocked selection layer: choose one fulfiller based on the request constraints.
      const selected = chooseFulfiller(fulfillerProfiles, amount, record.priority, record.maxFeeBps);
      logStep(
        "fulfill",
        `Selected fulfiller ${selected.id} for ${formatUnits(amount, 6)} USDC (${selected.note})`,
      );
      const fulfillerAddress = getAddress(selected.address);
      // The fulfiller delivers the user outcome before any CCTP settlement happens.
      const fulfillTxHash = await fulfillPayout(selected.id, record.recipient, amount);
      nextRecord = {
        ...record,
        selectedFulfiller: selected.id,
        fulfillerAddress,
        fulfillTxHash,
        status: "payout_sent" as const,
        updatedAt: new Date().toISOString(),
        logs: [
          ...record.logs,
          `Selected fulfiller ${selected.id}`,
          `Fulfiller ${selected.id} delivered payout`,
        ],
      };

      nextRecords.push(nextRecord);
      await saveIntents(nextRecords);
    }

    if (nextRecord.status !== "payout_sent" || !nextRecord.fulfillerAddress) {
      nextRecords.push(nextRecord);
      continue;
    }

    // Register who should be reimbursed once the later CCTP mint lands in the repayment contract.
    const repaymentRegistrationTxHash = await registerIntentRepayment(
      nextRecord.intentId,
      nextRecord.fulfillerAddress,
      amount,
      nextRecord.recipient,
    );

    const fulfilledRecord = {
      ...nextRecord,
      repaymentRegistrationTxHash,
      status: "fulfilled" as const,
      updatedAt: new Date().toISOString(),
      logs: [
        ...nextRecord.logs,
        "Repayment registered on Ethereum Sepolia",
      ],
    };

    if (record.status === "intent_created") {
      nextRecords[nextRecords.length - 1] = fulfilledRecord;
    } else {
      nextRecords.push(fulfilledRecord);
    }
  }

  await saveIntents(nextRecords);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
