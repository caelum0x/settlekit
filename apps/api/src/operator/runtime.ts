/**
 * Process-wide operator runtime for the API, built lazily from the
 * environment on first use (so importing the routes never touches the
 * network or database) and replaceable in tests.
 */
import { createOperatorRuntime, type OperatorRuntime } from "@settlekit/operator";
import { DEFAULT_ORG_ID } from "@settlekit/persistence";

let instance: OperatorRuntime | null = null;

function logError(context: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ level: "error", service: "operator", context, message })}\n`);
}

export function getOperatorRuntime(): OperatorRuntime {
  if (!instance) instance = createOperatorRuntime(process.env, DEFAULT_ORG_ID, { onError: logError });
  return instance;
}
