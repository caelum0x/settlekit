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

import { EscrowAgreementWithDetails } from "@/types/escrow";
import { parseAmount } from "@/lib/utils/amount";

const IN_PROGRESS_STATUSES = ["INITIATED", "OPEN", "LOCKED", "PENDING"];

export interface AgreementSummary {
  total: number;
  inProgress: number;
  closed: number;
  totalValue: number;
}

/**
 * Safely parse the headline amount for an agreement. The terms amount strings
 * are free-form (e.g. "$1,200.00"), so parsing can throw — treat unparseable
 * values as zero rather than letting a single bad record break the summary.
 */
export function getAgreementAmount(
  agreement: EscrowAgreementWithDetails
): number {
  const rawAmount = agreement.terms?.amounts?.[0]?.amount;

  if (!rawAmount) {
    return 0;
  }

  try {
    return parseAmount(rawAmount);
  } catch {
    return 0;
  }
}

/**
 * Compute aggregate stats over a list of escrow agreements. Pure function so
 * it can be reused by the summary API route and rendered directly in pages.
 */
export function summarizeAgreements(
  agreements: ReadonlyArray<EscrowAgreementWithDetails>
): AgreementSummary {
  return agreements.reduce<AgreementSummary>(
    (summary, agreement) => {
      const isClosed = agreement.status === "CLOSED";
      const isInProgress = IN_PROGRESS_STATUSES.includes(agreement.status);

      return {
        total: summary.total + 1,
        inProgress: summary.inProgress + (isInProgress ? 1 : 0),
        closed: summary.closed + (isClosed ? 1 : 0),
        totalValue: summary.totalValue + getAgreementAmount(agreement),
      };
    },
    { total: 0, inProgress: 0, closed: 0, totalValue: 0 }
  );
}
