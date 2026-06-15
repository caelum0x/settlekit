import {
  generateId,
  type Result,
  ok,
  err,
  validationError,
  type SettleKitError,
  type AgentService,
} from "@settlekit/common";
import { validateAgentPrice } from "./agent-pricing.js";
import { asJsonSchema, type JsonSchema } from "./json-schema-validate.js";

/** User-supplied fields when creating an agent service listing. */
export interface CreateAgentServiceInput {
  organizationId: string;
  merchantId: string;
  productId: string;
  name: string;
  description: string;
  endpoint: string;
  /** Per-request price in USDC major units, e.g. "0.05". */
  price: string;
  network: "arc" | "base";
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

const ENDPOINT_RE = /^https:\/\/[^\s]+$/;

function validateSchemaShape(
  schema: Record<string, unknown>,
  field: string,
): SettleKitError | undefined {
  const view = asJsonSchema(schema) as JsonSchema;
  if (view.type === undefined) {
    return validationError(`${field} must declare a top-level "type"`, { field });
  }
  return undefined;
}

/**
 * Create a new agent service marketplace listing (plan §11, §23).
 *
 * Validates the price (USDC, <=6dp), the endpoint (must be HTTPS) and that the
 * provided JSON schemas declare a top-level type. Returns the constructed,
 * unpublished `AgentService` or a `validation_error`.
 */
export function createAgentService(
  input: CreateAgentServiceInput,
  now: Date = new Date(),
): Result<AgentService, SettleKitError> {
  if (input.name.trim().length === 0) {
    return err(validationError("name is required", { field: "name" }));
  }
  if (input.description.trim().length === 0) {
    return err(validationError("description is required", { field: "description" }));
  }
  if (!ENDPOINT_RE.test(input.endpoint)) {
    return err(validationError("endpoint must be a valid https:// URL", { field: "endpoint" }));
  }

  let price: string;
  try {
    price = validateAgentPrice(input.price);
  } catch (cause) {
    return err(
      validationError("price must be a valid USDC amount", {
        field: "price",
        reason: cause instanceof Error ? cause.message : String(cause),
      }),
    );
  }

  const inputSchemaError = validateSchemaShape(input.inputSchema, "inputSchema");
  if (inputSchemaError) return err(inputSchemaError);
  if (input.outputSchema) {
    const outputSchemaError = validateSchemaShape(input.outputSchema, "outputSchema");
    if (outputSchemaError) return err(outputSchemaError);
  }

  const service: AgentService = {
    id: generateId("agentService"),
    organizationId: input.organizationId,
    merchantId: input.merchantId,
    productId: input.productId,
    name: input.name,
    description: input.description,
    endpoint: input.endpoint,
    price,
    currency: "USDC",
    paymentProtocol: "x402",
    network: input.network,
    inputSchema: input.inputSchema,
    ...(input.outputSchema ? { outputSchema: input.outputSchema } : {}),
    published: false,
    createdAt: now.toISOString(),
  };

  return ok(service);
}

/** Return a new copy of `service` marked as published. */
export function publishAgentService(service: AgentService): AgentService {
  return { ...service, published: true };
}

/** Return a new copy of `service` marked as unpublished. */
export function unpublishAgentService(service: AgentService): AgentService {
  return { ...service, published: false };
}
