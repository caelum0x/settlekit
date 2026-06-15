/**
 * Request-body validation at the API boundary.
 *
 * Parses a JSON body against a zod schema and, on failure, throws a
 * {@link SettleKitError} of code `validation_error` (HTTP 400) carrying the
 * flattened zod issues as structured `details`. Routes therefore never hand-roll
 * validation responses — they just `await parseBody(c, schema)`.
 */
import type { Context } from "hono";
import type { z } from "zod";
import { validationError, unwrapResult } from "./internal.js";

/**
 * Read and validate the JSON request body against `schema`.
 *
 * Throws `validation_error` when the body is not JSON or fails schema checks.
 */
export async function parseBody<S extends z.ZodTypeAny>(
  c: Context,
  schema: S,
): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw validationError("Request body must be valid JSON");
  }
  return validate(schema, raw);
}

/** Validate already-parsed input (e.g. query params) against a schema. */
export function validate<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw validationError("Invalid request input", {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
        code: issue.code,
      })),
    });
  }
  return result.data;
}

export { unwrapResult };
