/**
 * Process-wide operator runtime for the API, built lazily from the
 * environment on first use (so importing the routes never touches the
 * network or database). Disabled unless a vault is configured or
 * OPERATOR_SIMULATION=1 is set explicitly.
 */
import { SettleKitError } from "@settlekit/common";
import { createOperatorRuntime, operatorEnabled, type OperatorRuntime } from "@settlekit/operator";
import { DEFAULT_ORG_ID } from "@settlekit/persistence";

let instance: OperatorRuntime | null = null;

function logError(context: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ level: "error", service: "operator", context, message })}\n`);
}

export function getOperatorRuntime(): OperatorRuntime {
  if (instance) return instance;
  if (!operatorEnabled(process.env)) {
    throw new SettleKitError({
      code: "integration_error",
      message: "The operator is not configured (set OPERATOR_VAULT_ADDRESS, or OPERATOR_SIMULATION=1 for a local simulation)",
      httpStatus: 503,
    });
  }
  instance = createOperatorRuntime(process.env, DEFAULT_ORG_ID, { onError: logError });
  return instance;
}
