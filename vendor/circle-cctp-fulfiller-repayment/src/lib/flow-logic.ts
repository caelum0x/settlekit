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

/* Small decision helpers for fulfiller selection and fee calculations. */
import type { FulfillerProfile, IntentPriority } from "./types.js";

export function selectFinalityThreshold(
  requestedThreshold: number,
  confirmedFinality: number,
  finalizedFinality: number,
): number {
  return requestedThreshold <= confirmedFinality
    ? confirmedFinality
    : finalizedFinality;
}

export function calculateBufferedMaxFee(
  amount: bigint,
  minimumFeeBps: number,
  bufferBps: number,
): bigint {
  const feeBps = getBufferedFeeBps(minimumFeeBps, bufferBps);
  return (amount * BigInt(feeBps)) / 10_000n;
}

export function getBufferedFeeBps(
  minimumFeeBps: number,
  bufferBps: number,
): number {
  return Math.ceil(minimumFeeBps * (1 + bufferBps / 100));
}

export function hasReadyAttestationPayload(
  message?: `0x${string}`,
  attestation?: `0x${string}`,
): boolean {
  return Boolean(
    message &&
    attestation &&
    message !== "0x" &&
    attestation !== "0x" &&
    attestation.startsWith("0x"),
  );
}

export function chooseFulfiller(
  fulfillers: FulfillerProfile[],
  amountUsdc: bigint,
  priority: IntentPriority,
  maxFeeBps: number,
): FulfillerProfile {
  const eligible = fulfillers
    .filter((fulfiller) => fulfiller.maxAmountUsdc >= amountUsdc)
    .filter((fulfiller) => fulfiller.feeBps <= maxFeeBps);

  if (eligible.length === 0) {
    throw new Error(
      `No fulfiller satisfies amount=${amountUsdc} and maxFeeBps=${maxFeeBps}`,
    );
  }

  const sorted = [...eligible].sort((a, b) => {
    if (priority === "fast") {
      if (a.speedRank !== b.speedRank) return a.speedRank - b.speedRank;
      if (a.feeBps !== b.feeBps) return a.feeBps - b.feeBps;
    } else {
      if (a.feeBps !== b.feeBps) return a.feeBps - b.feeBps;
      if (a.speedRank !== b.speedRank) return a.speedRank - b.speedRank;
    }
    return a.id.localeCompare(b.id);
  });

  return sorted[0];
}
