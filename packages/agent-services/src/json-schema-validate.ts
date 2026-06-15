import { type Result, ok, err, validationError, type SettleKitError } from "@settlekit/common";

/**
 * Minimal, real JSON-Schema (draft subset) validation.
 *
 * Supports the keywords needed to describe agent service request bodies:
 *   - type: "object" | "string" | "number" | "integer" | "boolean" | "array" | "null"
 *   - required: string[]            (object)
 *   - properties: { [k]: schema }   (object)
 *   - additionalProperties: boolean (object, defaults to true)
 *   - items: schema                 (array)
 *   - enum: unknown[]               (any type)
 *
 * This is intentionally small and dependency-free — it is NOT a full draft-07
 * implementation, but every keyword it claims to support is implemented correctly.
 */

export type JsonSchemaType =
  | "object"
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "array"
  | "null";

export interface JsonSchema {
  type?: JsonSchemaType;
  required?: string[];
  properties?: Record<string, JsonSchema>;
  additionalProperties?: boolean;
  items?: JsonSchema;
  enum?: readonly unknown[];
}

export interface SchemaViolation {
  /** JSON pointer-ish path to the offending value, e.g. "/foo/0". */
  path: string;
  message: string;
}

/** Coerce an arbitrary record (e.g. `service.inputSchema`) into a JsonSchema view. */
export function asJsonSchema(schema: Record<string, unknown>): JsonSchema {
  return schema as JsonSchema;
}

function jsonTypeOf(value: unknown): JsonSchemaType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  const t = typeof value;
  if (t === "number") return Number.isInteger(value) ? "integer" : "number";
  if (t === "boolean") return "boolean";
  if (t === "string") return "string";
  return "object";
}

function typeMatches(expected: JsonSchemaType, value: unknown): boolean {
  const actual = jsonTypeOf(value);
  if (expected === "number") return actual === "number" || actual === "integer";
  return actual === expected;
}

function collect(
  schema: JsonSchema,
  value: unknown,
  path: string,
  out: SchemaViolation[],
): void {
  if (schema.enum !== undefined) {
    const matched = schema.enum.some((candidate) => deepEqual(candidate, value));
    if (!matched) {
      out.push({ path, message: `value is not one of the allowed enum values` });
      return;
    }
  }

  if (schema.type !== undefined) {
    if (!typeMatches(schema.type, value)) {
      out.push({ path, message: `expected type ${schema.type} but got ${jsonTypeOf(value)}` });
      return;
    }
  }

  if (schema.type === "object" && jsonTypeOf(value) === "object") {
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(record, key)) {
        out.push({ path: joinPath(path, key), message: `missing required property "${key}"` });
      }
    }
    const properties = schema.properties ?? {};
    const additionalAllowed = schema.additionalProperties !== false;
    for (const [key, child] of Object.entries(record)) {
      const propSchema = properties[key];
      if (propSchema !== undefined) {
        collect(propSchema, child, joinPath(path, key), out);
      } else if (!additionalAllowed) {
        out.push({ path: joinPath(path, key), message: `unexpected additional property "${key}"` });
      }
    }
  }

  if (schema.type === "array" && Array.isArray(value) && schema.items !== undefined) {
    value.forEach((item, index) => {
      collect(schema.items as JsonSchema, item, joinPath(path, String(index)), out);
    });
  }
}

function joinPath(base: string, segment: string): string {
  return base === "" ? `/${segment}` : `${base}/${segment}`;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (jsonTypeOf(a) !== jsonTypeOf(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  if (jsonTypeOf(a) === "object") {
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    const ka = Object.keys(ra);
    const kb = Object.keys(rb);
    return ka.length === kb.length && ka.every((k) => deepEqual(ra[k], rb[k]));
  }
  return false;
}

/** Returns the list of violations (empty when `value` conforms to `schema`). */
export function validateValueAgainstSchema(value: unknown, schema: JsonSchema): SchemaViolation[] {
  const out: SchemaViolation[] = [];
  collect(schema, value, "", out);
  return out;
}

/**
 * Validate an agent service input against its declared `inputSchema`.
 * Returns `ok(input)` when valid, or a `validation_error` carrying the violations.
 */
export function validateInputAgainstSchema(
  input: unknown,
  inputSchema: Record<string, unknown>,
): Result<unknown, SettleKitError> {
  const violations = validateValueAgainstSchema(input, asJsonSchema(inputSchema));
  if (violations.length > 0) {
    return err(
      validationError("Input does not match the agent service input schema", {
        violations,
      }),
    );
  }
  return ok(input);
}
