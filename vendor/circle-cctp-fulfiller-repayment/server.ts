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

import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { formatUnits } from "viem";

import { usdcAbi } from "./src/lib/abis.js";
import {
  sourceAccount,
  sourcePublicClient,
  destinationPublicClient,
} from "./src/config/chains.js";
import { env } from "./src/config/env.js";
import { loadIntents } from "./src/lib/runtime.js";

const execFileAsync = promisify(execFile);
const rootDir = process.cwd();
const publicDir = path.join(rootDir, "public");
const port = 3001;
const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};
const staticRoutes: Record<string, string> = {
  "/": "index.html",
  "/style.css": "style.css",
  "/scripts.js": "scripts.js",
  "/favicon.ico": "favicon.ico",
  "/diagram.png": "diagram.png",
  "/CCTP.png": "CCTP.png"
};

let isRunningAction = false;

const scriptMap = {
  intent: "intent",
  fulfill: "fulfill",
  settle: "settle",
} as const;

type ActionName = keyof typeof scriptMap;

type IntentOverrides = {
  amountUsdc?: string;
  priority?: "fast" | "cheap";
  maxFeeBps?: string;
  recipient?: string;
};

type BalanceSnapshot = {
  platformSourceUsdc: string;
  selectedFulfillerDestinationUsdc: string;
  contractorDestinationUsdc: string;
  repaymentContractDestinationUsdc: string;
};

function sendJson(
  response: import("node:http").ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

function sendText(
  response: import("node:http").ServerResponse,
  statusCode: number,
  body: string,
): void {
  response.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
  });
  response.end(body);
}

async function serveStatic(
  response: import("node:http").ServerResponse,
  filePath: string,
): Promise<void> {
  try {
    const body = await readFile(filePath);
    const ext = path.extname(filePath);
    const contentType = contentTypes[ext] ?? "application/octet-stream";
    response.writeHead(200, { "content-type": contentType });
    response.end(body);
  } catch {
    sendText(response, 404, "Not found");
  }
}

async function readJsonBody(
  request: import("node:http").IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
    string,
    unknown
  >;
}

function buildEnv(): NodeJS.ProcessEnv {
  return { ...process.env };
}

function buildScriptArgs(
  action: ActionName,
  overrides?: IntentOverrides,
): string[] {
  const args = ["run", scriptMap[action]];
  if (action !== "intent" || !overrides) return args;

  args.push("--");
  if (overrides.amountUsdc) args.push("--amount", overrides.amountUsdc);
  if (overrides.priority) args.push("--priority", overrides.priority);
  if (overrides.maxFeeBps) args.push("--max-fee-bps", overrides.maxFeeBps);
  if (overrides.recipient) args.push("--recipient", overrides.recipient);
  return args;
}

async function runAction(
  action: ActionName,
  overrides?: IntentOverrides,
): Promise<{ stdout: string; stderr: string }> {
  if (isRunningAction) {
    throw new Error("Another action is already running");
  }

  isRunningAction = true;
  try {
    const result = await execFileAsync("npm", buildScriptArgs(action, overrides), {
      cwd: rootDir,
      env: buildEnv(),
      maxBuffer: 1024 * 1024 * 10,
    });
    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  } finally {
    isRunningAction = false;
  }
}

async function readUsdcBalance(
  client: typeof sourcePublicClient | typeof destinationPublicClient,
  tokenAddress: `0x${string}`,
  account: `0x${string}` | undefined,
): Promise<string> {
  if (!account) return "-";
  const balance = await client.readContract({
    address: tokenAddress,
    abi: usdcAbi,
    functionName: "balanceOf",
    args: [account],
  });
  return Number(formatUnits(balance, 6)).toFixed(3);
}

async function loadBalances(): Promise<BalanceSnapshot> {
  const intents = await loadIntents();
  const latest = intents.at(-1);

  return {
    platformSourceUsdc: await readUsdcBalance(
      sourcePublicClient,
      env.sourceUsdcAddress,
      sourceAccount.address,
    ),
    selectedFulfillerDestinationUsdc: await readUsdcBalance(
      destinationPublicClient,
      env.destinationUsdcAddress,
      latest?.fulfillerAddress,
    ),
    contractorDestinationUsdc: await readUsdcBalance(
      destinationPublicClient,
      env.destinationUsdcAddress,
      latest?.recipient,
    ),
    repaymentContractDestinationUsdc: await readUsdcBalance(
      destinationPublicClient,
      env.destinationUsdcAddress,
      env.repaymentContractAddress,
    ),
  };
}

const server = createServer(async (request, response) => {
  const url = new URL(
    request.url ?? "/",
    `http://${request.headers.host ?? "localhost"}`,
  );

  const staticFile = staticRoutes[url.pathname];
  if (request.method === "GET" && staticFile) {
    await serveStatic(response, path.join(publicDir, staticFile));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/status") {
    const intents = await loadIntents();
    sendJson(response, 200, { intents, isRunningAction });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/balances") {
    try {
      const balances = await loadBalances();
      sendJson(response, 200, balances);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      sendJson(response, 500, { error: message });
    }
    return;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/")) {
    const action = url.pathname.replace("/api/", "");
    if (!(action in scriptMap)) {
      sendJson(response, 404, { error: "Unknown action" });
      return;
    }

    try {
      const body = await readJsonBody(request);
      const overrides: IntentOverrides | undefined =
        action === "intent"
          ? {
              amountUsdc:
                typeof body.amountUsdc === "string"
                  ? body.amountUsdc
                  : undefined,
              priority:
                body.priority === "fast" || body.priority === "cheap"
                  ? body.priority
                  : undefined,
              maxFeeBps:
                typeof body.maxFeeBps === "string" ? body.maxFeeBps : undefined,
              recipient:
                typeof body.recipient === "string" ? body.recipient : undefined,
            }
          : undefined;
      const result = await runAction(action as ActionName, overrides);
      const intents = await loadIntents();
      sendJson(response, 200, {
        action,
        stdout: result.stdout,
        stderr: result.stderr,
        intents,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      sendJson(response, 500, { error: message });
    }
    return;
  }

  sendText(response, 404, "Not found");
});

server.listen(port, () => {
  console.log(
    `Fulfiller repayment demo UI available at http://localhost:${port}`,
  );
});
