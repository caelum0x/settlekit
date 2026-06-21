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

/* Mock fulfiller profiles used by the selector. */
import { parseUnits } from "viem";
import {
  fulfillerAlphaAccount,
  fulfillerBetaAccount,
  fulfillerGammaAccount,
} from "../config/chains.js";
import type { FulfillerProfile } from "./types.js";

export const fulfillerProfiles: FulfillerProfile[] = [
  {
    id: "alpha",
    address: fulfillerAlphaAccount.address,
    feeBps: 5,
    speedRank: 3,
    maxAmountUsdc: parseUnits("100", 6),
    note: "cheaper, slower, handles larger intents",
  },
  {
    id: "beta",
    address: fulfillerBetaAccount.address,
    feeBps: 12,
    speedRank: 1,
    maxAmountUsdc: parseUnits("100", 6),
    note: "faster, more expensive",
  },
  {
    id: "gamma",
    address: fulfillerGammaAccount.address,
    feeBps: 3,
    speedRank: 2,
    maxAmountUsdc: parseUnits("3", 6),
    note: "cheapest for smaller intents",
  },
] as const;
