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

/* Local demo-state persistence for intent records and logs. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { IntentRecord } from "./types.js";

const dataDir = path.resolve(process.cwd(), "data");
const intentsPath = path.join(dataDir, "intents.json");

export function logStep(scope: string, message: string): void {
  console.log(`[${new Date().toISOString()}] [${scope}] ${message}`);
}

async function ensureStore(): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  try {
    await readFile(intentsPath, "utf8");
  } catch {
    await writeFile(intentsPath, "[]\n", "utf8");
  }
}

export async function loadIntents(): Promise<IntentRecord[]> {
  await ensureStore();
  const raw = await readFile(intentsPath, "utf8");
  return JSON.parse(raw) as IntentRecord[];
}

export async function saveIntents(records: IntentRecord[]): Promise<void> {
  await ensureStore();
  await writeFile(intentsPath, `${JSON.stringify(records, null, 2)}\n`, "utf8");
}

export async function appendIntent(record: IntentRecord): Promise<void> {
  const records = await loadIntents();
  records.push(record);
  await saveIntents(records);
}
