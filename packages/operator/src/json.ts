/**
 * JSON codec for operator records.
 *
 * Records carry bigint amounts; JSON cannot. `toJsonValue` encodes bigint as a
 * tagged object `{ "$bigint": "123" }` (lossless, unambiguous) and
 * `fromJsonValue` reverses it. `canonicalJson` produces a deterministic string
 * (object keys sorted, undefined dropped) used for hashing.
 */

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

const BIGINT_TAG = "$bigint";

/** Encode an arbitrary record (with bigints) into a plain JSON value. */
export function toJsonValue(value: unknown): JsonValue {
  if (value === null) return null;
  switch (typeof value) {
    case "bigint":
      return { [BIGINT_TAG]: value.toString() };
    case "boolean":
    case "string":
      return value;
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("Non-finite number is not JSON-safe");
      return value;
    case "object":
      return encodeObject(value);
    default:
      throw new TypeError(`Unsupported value type: ${typeof value}`);
  }
}

function encodeObject(value: object): JsonValue {
  if (Array.isArray(value)) return value.map((v) => toJsonValue(v === undefined ? null : v));
  if (value instanceof Date) return value.toISOString();
  const out: Record<string, JsonValue> = {};
  for (const [key, v] of Object.entries(value)) {
    if (v !== undefined) out[key] = toJsonValue(v);
  }
  return out;
}

/** Decode a JSON value produced by {@link toJsonValue}, restoring bigints. */
export function fromJsonValue<T>(value: unknown): T {
  return decode(value) as T;
}

function decode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decode);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const only = entries.length === 1 ? entries[0] : undefined;
    if (only && only[0] === BIGINT_TAG && typeof only[1] === "string") {
      return BigInt(only[1]);
    }
    return Object.fromEntries(entries.map(([k, v]) => [k, decode(v)]));
  }
  return value;
}

/** Deterministic JSON: sorted keys at every depth, bigints tagged. */
export function canonicalJson(value: unknown): string {
  return stringifySorted(toJsonValue(value));
}

function stringifySorted(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stringifySorted).join(",")}]`;
  const obj = value as { readonly [key: string]: JsonValue };
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stringifySorted(obj[k] as JsonValue)}`).join(",")}}`;
}
