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

/**
 * Canonical catalog of the x402-protected premium endpoints the seller exposes.
 *
 * This is the single source of truth for endpoint metadata shared across the
 * dashboard catalog page, the per-endpoint earnings API, and the analytics
 * overview. The `path` values must match the `endpoint` strings recorded in
 * `payment_events` by `withGateway()` (see lib/x402.ts).
 */

export type HttpMethod = "GET" | "POST";

export interface PremiumEndpoint {
  /** Canonical path, matches payment_events.endpoint */
  path: string;
  /** Human-friendly name */
  name: string;
  /** Short description of what the resource returns */
  description: string;
  /** HTTP method the buyer must use */
  method: HttpMethod;
  /** Price in USDC dollars (e.g. "0.001") */
  price: string;
  /** Lucide icon name used by the catalog UI */
  icon: "Quote" | "Database" | "Cpu" | "Bot";
  /** Optional example JSON body for POST endpoints */
  sampleBody?: Record<string, unknown>;
}

export const PREMIUM_ENDPOINTS: readonly PremiumEndpoint[] = [
  {
    path: "/api/premium/quote",
    name: "Inspirational Quote",
    description:
      "Returns a single curated technology quote. The cheapest resource in the catalog — ideal for demonstrating sub-cent settlement.",
    method: "GET",
    price: "0.001",
    icon: "Quote",
  },
  {
    path: "/api/premium/compute",
    name: "Text Analysis",
    description:
      "Accepts arbitrary text and returns word, sentence, and character counts plus a short summary. Billed per request.",
    method: "POST",
    price: "0.0003",
    icon: "Cpu",
    sampleBody: { text: "The quick brown fox jumps over the lazy dog." },
  },
  {
    path: "/api/premium/dataset",
    name: "Analytics Dataset",
    description:
      "Returns a snapshot of product analytics metrics (DAU, session length, conversion, churn). A mid-tier paid data feed.",
    method: "GET",
    price: "0.01",
    icon: "Database",
  },
  {
    path: "/api/premium/agent-task",
    name: "Agent Task (Treasure Hunt)",
    description:
      "Returns the next clue in a multi-step treasure hunt. The premium tier, designed for autonomous agents paying across a session.",
    method: "GET",
    price: "0.03",
    icon: "Bot",
  },
] as const;

export function findEndpoint(path: string): PremiumEndpoint | undefined {
  return PREMIUM_ENDPOINTS.find((e) => e.path === path);
}
