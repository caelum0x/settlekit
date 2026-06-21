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

/* Destination-side payout and repayment helpers for the selected fulfiller. */
import { formatUnits } from "viem";
import {
  destinationPublicClient,
  destinationWalletClient,
  fulfillerAlphaWalletClient,
  fulfillerBetaWalletClient,
  fulfillerGammaWalletClient,
} from "../config/chains.js";
import { env } from "../config/env.js";
import { repaymentAbi, usdcAbi } from "./abis.js";
import { logStep } from "./runtime.js";
import type { FulfillerId } from "./types.js";

const fulfillerWalletClients = {
  alpha: fulfillerAlphaWalletClient,
  beta: fulfillerBetaWalletClient,
  gamma: fulfillerGammaWalletClient,
} as const;

export async function registerIntentRepayment(
  intentId: `0x${string}`,
  fulfiller: `0x${string}`,
  amount: bigint,
  recipient: `0x${string}`,
): Promise<`0x${string}`> {
  // The contract stores who fronted the payout so the later CCTP mint can reimburse the right address.
  const hash = await destinationWalletClient.writeContract({
    address: env.repaymentContractAddress,
    abi: repaymentAbi,
    functionName: "registerIntentRepayment",
    args: [intentId, fulfiller, amount, recipient],
    account: destinationWalletClient.account,
    chain: destinationWalletClient.chain,
  });
  await destinationPublicClient.waitForTransactionReceipt({ hash });
  logStep(
    "repayment",
    `Registered repayment for ${formatUnits(amount, 6)} USDC to fulfiller ${fulfiller}`,
  );
  return hash;
}

export async function fulfillPayout(
  fulfillerId: FulfillerId,
  recipient: `0x${string}`,
  amount: bigint,
): Promise<`0x${string}`> {
  const walletClient = fulfillerWalletClients[fulfillerId];
  // The fulfiller uses its own balance on Sepolia to deliver the user outcome immediately.
  const hash = await walletClient.writeContract({
    address: env.destinationUsdcAddress,
    abi: usdcAbi,
    functionName: "transfer",
    args: [recipient, amount],
    account: walletClient.account,
    chain: walletClient.chain,
  });
  await destinationPublicClient.waitForTransactionReceipt({ hash });
  logStep(
    "fulfill",
    `${fulfillerId} fronted ${formatUnits(amount, 6)} USDC to ${recipient}`,
  );
  return hash;
}

export async function repayFulfiller(
  intentId: `0x${string}`,
): Promise<`0x${string}`> {
  // This is the final reimbursement step after the CCTP mint has already funded the contract.
  const hash = await destinationWalletClient.writeContract({
    address: env.repaymentContractAddress,
    abi: repaymentAbi,
    functionName: "releaseToFulfiller",
    args: [intentId],
    account: destinationWalletClient.account,
    chain: destinationWalletClient.chain,
  });
  await destinationPublicClient.waitForTransactionReceipt({ hash });
  logStep("repayment", `Released repayment for intent ${intentId}`);
  return hash;
}
