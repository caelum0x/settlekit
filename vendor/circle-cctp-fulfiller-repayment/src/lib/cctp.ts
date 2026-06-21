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

/* CCTP settlement helpers: burn, attestation lookup, fee quote, and destination mint. */
import {
  encodeAbiParameters,
  formatUnits,
  isHex,
  keccak256,
  parseUnits,
} from "viem";
import {
  ARC_DOMAIN,
  CONFIRMED_FINALITY,
  DESTINATION_DOMAIN,
  FINALIZED_FINALITY,
  ZERO_BYTES32,
  destinationPublicClient,
  destinationWalletClient,
  sourcePublicClient,
  sourceWalletClient,
} from "../config/chains.js";
import { env } from "../config/env.js";
import {
  calculateBufferedMaxFee,
  getBufferedFeeBps,
  hasReadyAttestationPayload,
  selectFinalityThreshold,
} from "./flow-logic.js";
import {
  tokenMessengerV2Abi,
  messageTransmitterV2Abi,
  usdcAbi,
} from "./abis.js";
import { logStep } from "./runtime.js";
import type {
  BurnFeeResponse,
  BurnQuote,
  IrisMessageResponse,
} from "./types.js";

const testnetContracts = {
  tokenMessengerV2: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
  messageTransmitterV2: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275",
} as const;

export function createIntentId(
  recipient: `0x${string}`,
  amount: bigint,
  priority: string,
): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "uint256" },
        { type: "string" },
        { type: "uint256" },
      ],
      [recipient, amount, priority, BigInt(Date.now())],
    ),
  );
}

function encodeAddressToBytes32(address: `0x${string}`): `0x${string}` {
  return encodeAbiParameters([{ type: "address" }], [address]);
}

function getNormalizedThreshold(): number {
  return selectFinalityThreshold(
    env.transferFinalityThreshold,
    CONFIRMED_FINALITY,
    FINALIZED_FINALITY,
  );
}

export async function approveUsdc(amount: bigint): Promise<`0x${string}`> {
  const hash = await sourceWalletClient.writeContract({
    address: env.sourceUsdcAddress,
    abi: usdcAbi,
    functionName: "approve",
    args: [testnetContracts.tokenMessengerV2, amount],
    account: sourceWalletClient.account,
    chain: sourceWalletClient.chain,
  });
  await sourcePublicClient.waitForTransactionReceipt({ hash });
  logStep(
    "source",
    `Approved ${formatUnits(amount, 6)} USDC on Arc Testnet for TokenMessengerV2`,
  );
  return hash;
}

async function getRouteFee(amount: bigint): Promise<bigint> {
  const minimumFeeBps = await getMinimumFeeBps();
  return calculateBufferedMaxFee(
    amount,
    minimumFeeBps,
    env.transferFeeBufferBps,
  );
}

async function getMinimumFeeBps(): Promise<number> {
  const response = await fetch(
    `${env.irisApiUrl}/v2/burn/USDC/fees/${ARC_DOMAIN}/${DESTINATION_DOMAIN}`,
  );
  if (!response.ok)
    throw new Error(
      `Iris fee request failed: ${response.status} ${response.statusText}`,
    );
  const json = (await response.json()) as BurnFeeResponse;
  const fees = Array.isArray(json) ? json : (json.data ?? []);
  const threshold = getNormalizedThreshold();
  const selectedFee = fees.find((fee) => fee.finalityThreshold === threshold);
  if (!selectedFee)
    throw new Error(`No Iris fee returned for finality threshold ${threshold}`);
  return selectedFee.minimumFee;
}

export async function quoteBurn(amount: bigint): Promise<BurnQuote> {
  const minFinalityThreshold = getNormalizedThreshold();
  const maxFee = await getRouteFee(amount);
  const destinationAmount = amount - maxFee;
  if (destinationAmount <= 0n)
    throw new Error(
      "Configured transfer fee is greater than or equal to the burn amount",
    );
  return {
    sourceAmount: amount,
    maxFee,
    minFinalityThreshold,
    destinationAmount,
  };
}

export async function quoteBurnForTargetDestination(
  targetDestinationAmount: bigint,
): Promise<BurnQuote> {
  const minFinalityThreshold = getNormalizedThreshold();
  const minimumFeeBps = await getMinimumFeeBps();
  const bufferedFeeBps = getBufferedFeeBps(
    minimumFeeBps,
    env.transferFeeBufferBps,
  );
  if (bufferedFeeBps >= 10_000) {
    throw new Error(
      `Buffered fee bps must be below 10000, received ${bufferedFeeBps}`,
    );
  }

  let sourceAmount =
    (targetDestinationAmount * 10_000n + BigInt(9_999 - bufferedFeeBps)) /
    BigInt(10_000 - bufferedFeeBps);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const maxFee = calculateBufferedMaxFee(
      sourceAmount,
      minimumFeeBps,
      env.transferFeeBufferBps,
    );
    const destinationAmount = sourceAmount - maxFee;
    if (destinationAmount >= targetDestinationAmount) {
      return { sourceAmount, maxFee, minFinalityThreshold, destinationAmount };
    }
    sourceAmount += 1n;
  }

  throw new Error(
    "Unable to compute a source burn amount that covers the target destination repayment",
  );
}

export async function burnToRepaymentContract(
  amount: bigint,
  quote?: BurnQuote,
): Promise<`0x${string}`> {
  const burnQuote = quote ?? (await quoteBurn(amount));
  // Minting to the repayment contract, rather than the end recipient, preserves the reimbursement step.
  const hash = await sourceWalletClient.writeContract({
    address: testnetContracts.tokenMessengerV2,
    abi: tokenMessengerV2Abi,
    functionName: "depositForBurn",
    args: [
      burnQuote.sourceAmount,
      DESTINATION_DOMAIN,
      encodeAddressToBytes32(env.repaymentContractAddress),
      env.sourceUsdcAddress,
      ZERO_BYTES32,
      burnQuote.maxFee,
      burnQuote.minFinalityThreshold,
    ],
    account: sourceWalletClient.account,
    chain: sourceWalletClient.chain,
  });
  await sourcePublicClient.waitForTransactionReceipt({ hash });
  logStep(
    "source",
    `Burn submitted on Arc Testnet toward repayment contract: ${hash} (${formatUnits(
      burnQuote.sourceAmount,
      6,
    )} USDC source -> ${formatUnits(burnQuote.destinationAmount, 6)} USDC on Sepolia)`,
  );
  return hash;
}

export async function fetchAttestation(
  txHash: `0x${string}`,
): Promise<{ message: `0x${string}`; attestation: `0x${string}` } | null> {
  const url = `${env.irisApiUrl}/v2/messages/${ARC_DOMAIN}?transactionHash=${txHash}`;
  const response = await fetch(url);
  if (response.status === 404) return null;
  if (!response.ok)
    throw new Error(
      `Iris request failed: ${response.status} ${response.statusText}`,
    );
  const json = (await response.json()) as IrisMessageResponse;
  const firstMessage = json.messages?.[0];
  if (!firstMessage?.message || !firstMessage.attestation) return null;
  if (!isHex(firstMessage.message) || !isHex(firstMessage.attestation))
    return null;
  if (
    !hasReadyAttestationPayload(firstMessage.message, firstMessage.attestation)
  )
    return null;
  return {
    message: firstMessage.message,
    attestation: firstMessage.attestation,
  };
}

export function estimateAttestationExpiry(): string {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
}

export async function mintOnDestination(
  message: `0x${string}`,
  attestation: `0x${string}`,
): Promise<`0x${string}`> {
  // This completes the destination-side CCTP settlement into the repayment contract on Sepolia.
  const hash = await destinationWalletClient.writeContract({
    address: testnetContracts.messageTransmitterV2,
    abi: messageTransmitterV2Abi,
    functionName: "receiveMessage",
    args: [message, attestation],
    account: destinationWalletClient.account,
    chain: destinationWalletClient.chain,
  });
  await destinationPublicClient.waitForTransactionReceipt({ hash });
  logStep(
    "destination",
    `Destination mint completed on Ethereum Sepolia: ${hash}`,
  );
  return hash;
}

export function parseUsdcAmount(amount: string): bigint {
  return parseUnits(amount, 6);
}
