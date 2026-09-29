/** Server-only factory for the operator API client, keyed from env. */
import "server-only";
import { createOperatorApiClient, type OperatorApiClient } from "./api-client";
import { loadConsoleConfig, type ConsoleConfig } from "./config";

export function consoleConfig(): ConsoleConfig {
  return loadConsoleConfig();
}

export function operatorApi(config: ConsoleConfig = loadConsoleConfig()): OperatorApiClient {
  return createOperatorApiClient({ baseUrl: config.apiUrl, apiKey: config.apiKey });
}
