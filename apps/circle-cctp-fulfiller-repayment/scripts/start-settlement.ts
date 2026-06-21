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

import { setTimeout as sleep } from "node:timers/promises";

import {
  approveUsdc,
  burnToRepaymentContract,
  estimateAttestationExpiry,
  fetchAttestation,
  mintOnDestination,
  parseUsdcAmount,
  quoteBurnForTargetDestination,
} from "../src/lib/cctp.js";
import { env } from "../src/config/env.js";
import { repayFulfiller } from "../src/lib/repayment.js";
import { loadIntents, logStep, saveIntents } from "../src/lib/runtime.js";

async function waitForAttestation(sourceTxHash: `0x${string}`): Promise<{ message: `0x${string}`; attestation: `0x${string}` }> {
  // The repayment leg cannot continue until Iris returns the attested burn message.
  for (let attempt = 1; attempt <= env.irisPollMaxAttempts; attempt += 1) {
    const result = await fetchAttestation(sourceTxHash);
    if (result) return result;
    logStep("settle", `Attestation not ready for ${sourceTxHash} (attempt ${attempt}/${env.irisPollMaxAttempts})`);
    if (attempt < env.irisPollMaxAttempts) {
      await sleep(env.irisPollIntervalSeconds * 1000);
    }
  }

  throw new Error(`Attestation did not become available after ${env.irisPollMaxAttempts} attempts`);
}

function isAlreadyUsedNonceError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("Nonce already used");
}

async function main(): Promise<void> {
  const records = await loadIntents();
  const nextRecords = [...records];

  for (const [index, record] of records.entries()) {
    if (!["fulfilled", "settlement_pending", "mint_completed"].includes(record.status)) {
      continue;
    }

    if (record.status === "fulfilled") {
      const targetRepaymentAmount = parseUsdcAmount(record.amountUsdc);
      const quote = await quoteBurnForTargetDestination(targetRepaymentAmount);
      // Burn on Arc now, repay the fulfiller later on Sepolia.
      await approveUsdc(quote.sourceAmount);
      const sourceTxHash = await burnToRepaymentContract(quote.sourceAmount, quote);
      logStep("settle", `Settlement started for intent ${record.intentId}`);
      nextRecords[index] = {
        ...record,
        sourceTxHash,
        status: "settlement_pending" as const,
        updatedAt: new Date().toISOString(),
        logs: [
          ...record.logs,
          `CCTP settlement submitted toward repayment contract (${record.amountUsdc} USDC target repayment)`,
        ],
      };
      await saveIntents(nextRecords);
    }

    if (nextRecords[index].status === "settlement_pending") {
      const sourceTxHash = nextRecords[index].sourceTxHash;
      if (!sourceTxHash) {
        throw new Error(`Missing source tx hash for settlement_pending intent ${nextRecords[index].intentId}`);
      }

      const result = await waitForAttestation(sourceTxHash);
      let mintTxHash = nextRecords[index].mintTxHash;
      try {
        mintTxHash = await mintOnDestination(result.message, result.attestation);
      } catch (error) {
        if (!isAlreadyUsedNonceError(error)) {
          throw error;
        }
        logStep("settle", `Mint already completed for intent ${nextRecords[index].intentId}; continuing to repayment`);
      }

      nextRecords[index] = {
        ...nextRecords[index],
        message: result.message,
        attestation: result.attestation,
        attestationExpiresAt: estimateAttestationExpiry(),
        mintTxHash,
        status: "mint_completed" as const,
        updatedAt: new Date().toISOString(),
        logs: [...nextRecords[index].logs, "Destination mint completed into repayment contract"],
      };
      await saveIntents(nextRecords);
    }

    if (nextRecords[index].status === "mint_completed") {
      // Once the mint lands in the repayment contract, the operator can release those funds to the fulfiller.
      const repaymentTxHash = await repayFulfiller(nextRecords[index].intentId);
      nextRecords[index] = {
        ...nextRecords[index],
        repaymentTxHash,
        status: "repaid" as const,
        updatedAt: new Date().toISOString(),
        logs: [
          ...nextRecords[index].logs,
          `Repayment released to fulfiller ${nextRecords[index].selectedFulfiller ?? "unknown"}`,
        ],
      };
      await saveIntents(nextRecords);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
