/**
 * Minimal structured logger for the worker. Emits one JSON line per event so
 * logs are machine-parseable in production while remaining readable in dev. The
 * logger is the single sink for all job output — no stray `console.log` calls
 * live in job code.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

function emit(level: LogLevel, bindings: Record<string, unknown>, message: string, fields?: Record<string, unknown>): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...bindings,
    ...fields,
  });
  if (level === "error" || level === "warn") {
    process.stderr.write(`${line}\n`);
  } else {
    process.stdout.write(`${line}\n`);
  }
}

/** Build a logger, optionally bound with persistent fields (e.g. job name). */
export function createLogger(bindings: Record<string, unknown> = {}): Logger {
  return {
    debug: (message, fields) => emit("debug", bindings, message, fields),
    info: (message, fields) => emit("info", bindings, message, fields),
    warn: (message, fields) => emit("warn", bindings, message, fields),
    error: (message, fields) => emit("error", bindings, message, fields),
    child: (extra) => createLogger({ ...bindings, ...extra }),
  };
}

/** Narrow an unknown thrown value to a human-readable message. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "Unexpected error";
}
