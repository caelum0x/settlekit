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

/* Environment loading and checked-in demo defaults. */
import { getAddress } from "viem";

const defaultConfig = {
  sourceUsdcAddress: getAddress("0x3600000000000000000000000000000000000000"),
  destinationUsdcAddress: getAddress("0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"),
  recipientAddress: getAddress("0xB1436Df5a153717bD0dE0CB31279d61324B451dA"),
  irisApiUrl: "https://iris-api-sandbox.circle.com",
  irisPollIntervalSeconds: 10,
  irisPollMaxAttempts: 60,
  transferFinalityThreshold: 1000,
  transferFeeBufferBps: 20,
} as const;

export const intentDefaults = {
  amountUsdc: "5",
  priority: "fast" as const,
  maxFeeBps: 20,
} as const;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function normalizeHexKey(name: string): `0x${string}` {
  const value = requireEnv(name);
  return (value.startsWith("0x") ? value : `0x${value}`) as `0x${string}`;
}

export const env = {
  operatorPrivateKey: normalizeHexKey("OPERATOR_PRIVATE_KEY"),
  sourceUsdcAddress: defaultConfig.sourceUsdcAddress,
  destinationUsdcAddress: defaultConfig.destinationUsdcAddress,
  fulfillerAlphaPrivateKey: normalizeHexKey("FULFILLER_ALPHA_PRIVATE_KEY"),
  fulfillerBetaPrivateKey: normalizeHexKey("FULFILLER_BETA_PRIVATE_KEY"),
  fulfillerGammaPrivateKey: normalizeHexKey("FULFILLER_GAMMA_PRIVATE_KEY"),
  repaymentContractAddress: getAddress(
    requireEnv("REPAYMENT_CONTRACT_ADDRESS"),
  ),
  recipientAddress: defaultConfig.recipientAddress,
  irisApiUrl: defaultConfig.irisApiUrl,
  irisPollIntervalSeconds: defaultConfig.irisPollIntervalSeconds,
  irisPollMaxAttempts: defaultConfig.irisPollMaxAttempts,
  transferFinalityThreshold: defaultConfig.transferFinalityThreshold,
  transferFeeBufferBps: defaultConfig.transferFeeBufferBps,
} as const;
