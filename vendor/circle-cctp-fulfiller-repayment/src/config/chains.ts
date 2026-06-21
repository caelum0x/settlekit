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

/* Chain clients, accounts, and CCTP domain wiring for the demo corridor. */
import { http, createPublicClient, createWalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet, sepolia } from "viem/chains";

import { env } from "./env.js";

const sepoliaRpcUrl = "https://1rpc.io/sepolia";

export const sourceAccount = privateKeyToAccount(env.operatorPrivateKey);
export const destinationOperatorAccount = privateKeyToAccount(
  env.operatorPrivateKey,
);
export const fulfillerAlphaAccount = privateKeyToAccount(
  env.fulfillerAlphaPrivateKey,
);
export const fulfillerBetaAccount = privateKeyToAccount(
  env.fulfillerBetaPrivateKey,
);
export const fulfillerGammaAccount = privateKeyToAccount(
  env.fulfillerGammaPrivateKey,
);

export const sourcePublicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(),
});
export const sourceWalletClient = createWalletClient({
  account: sourceAccount,
  chain: arcTestnet,
  transport: http(),
});
export const destinationPublicClient = createPublicClient({
  chain: sepolia,
  transport: http(sepoliaRpcUrl),
});
export const destinationWalletClient = createWalletClient({
  account: destinationOperatorAccount,
  chain: sepolia,
  transport: http(sepoliaRpcUrl),
});
export const fulfillerAlphaWalletClient = createWalletClient({
  account: fulfillerAlphaAccount,
  chain: sepolia,
  transport: http(sepoliaRpcUrl),
});
export const fulfillerBetaWalletClient = createWalletClient({
  account: fulfillerBetaAccount,
  chain: sepolia,
  transport: http(sepoliaRpcUrl),
});
export const fulfillerGammaWalletClient = createWalletClient({
  account: fulfillerGammaAccount,
  chain: sepolia,
  transport: http(sepoliaRpcUrl),
});

export const ARC_DOMAIN = 26;
export const DESTINATION_DOMAIN = 0;
export const CONFIRMED_FINALITY = 1000;
export const FINALIZED_FINALITY = 2000;
export const ZERO_BYTES32 = `0x${"0".repeat(64)}` as const;
