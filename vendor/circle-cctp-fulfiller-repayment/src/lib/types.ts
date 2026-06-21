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

export type IntentPriority = "fast" | "cheap";
export type FulfillerId = "alpha" | "beta" | "gamma";
export type IntentStatus =
  | "intent_created"
  | "payout_sent"
  | "fulfilled"
  | "settlement_pending"
  | "mint_completed"
  | "repaid";

export type IntentRecord = {
  intentId: `0x${string}`;
  recipient: `0x${string}`;
  amountUsdc: string;
  priority: IntentPriority;
  maxFeeBps: number;
  selectedFulfiller?: FulfillerId;
  fulfillerAddress?: `0x${string}`;
  fulfillTxHash?: `0x${string}`;
  repaymentRegistrationTxHash?: `0x${string}`;
  sourceTxHash?: `0x${string}`;
  mintTxHash?: `0x${string}`;
  repaymentTxHash?: `0x${string}`;
  message?: `0x${string}`;
  attestation?: `0x${string}`;
  attestationExpiresAt?: string;
  status: IntentStatus;
  createdAt: string;
  updatedAt: string;
  logs: string[];
};

export type FulfillerProfile = {
  id: FulfillerId;
  address: `0x${string}`;
  feeBps: number;
  speedRank: number;
  maxAmountUsdc: bigint;
  note: string;
};

export type IrisMessageResponse = {
  messages?: Array<{ message: `0x${string}`; attestation: `0x${string}` }>;
};

export type BurnFeeResponse =
  | Array<{ finalityThreshold: number; minimumFee: number }>
  | { data?: Array<{ finalityThreshold: number; minimumFee: number }> };

export type BurnQuote = {
  sourceAmount: bigint;
  maxFee: bigint;
  minFinalityThreshold: number;
  destinationAmount: bigint;
};
