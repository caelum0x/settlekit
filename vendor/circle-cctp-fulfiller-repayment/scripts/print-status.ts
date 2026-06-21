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

import { loadIntents } from "../src/lib/runtime.js";

async function main(): Promise<void> {
  const records = await loadIntents();
  if (records.length === 0) {
    console.log("No intents recorded.");
    return;
  }

  for (const record of records) {
    console.log(`\n${record.intentId}`);
    console.log(`  status: ${record.status}`);
    console.log(`  recipient: ${record.recipient}`);
    console.log(`  amount: ${record.amountUsdc} USDC`);
    console.log(`  priority: ${record.priority}`);
    console.log(`  selected fulfiller: ${record.selectedFulfiller ?? "-"}`);
    console.log(`  fulfiller address: ${record.fulfillerAddress ?? "-"}`);
    console.log(`  fulfill tx: ${record.fulfillTxHash ?? "-"}`);
    console.log(`  repayment registration tx: ${record.repaymentRegistrationTxHash ?? "-"}`);
    console.log(`  source tx: ${record.sourceTxHash ?? "-"}`);
    console.log(`  mint tx: ${record.mintTxHash ?? "-"}`);
    console.log(`  repayment tx: ${record.repaymentTxHash ?? "-"}`);
    console.log("  logs:");
    for (const line of record.logs) console.log(`    - ${line}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
