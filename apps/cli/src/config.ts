/**
 * Resolves the SettleKit API connection settings (base URL + API key).
 *
 * Resolution order (highest precedence first):
 *   1. Explicit CLI flags (`--api-url`, `--api-key`)
 *   2. Environment variables (`SETTLEKIT_API_URL`, `SETTLEKIT_API_KEY`)
 *   3. Built-in defaults (base URL only)
 *
 * The API key has no default — commands that need it surface a clear error when
 * it is missing rather than sending an unauthenticated request.
 */

/** Default base URL used when neither a flag nor an env var is provided. */
export const DEFAULT_API_URL = "http://localhost:8787";

/** Global options injected by the root command into every subcommand. */
export interface GlobalOptions {
  apiUrl?: string;
  apiKey?: string;
  json?: boolean;
}

/** Fully resolved connection settings consumed by the API client. */
export interface ResolvedConfig {
  /** Base URL without a trailing slash, e.g. `http://localhost:8787`. */
  baseUrl: string;
  /** Bearer API key, or `undefined` when none could be resolved. */
  apiKey: string | undefined;
  /** Whether the caller asked for raw JSON output. */
  json: boolean;
}

/** Strip any trailing slash so URL joining stays predictable. */
function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Merge flags, environment, and defaults into a single {@link ResolvedConfig}.
 *
 * @param opts Global options parsed from the command line.
 * @param env  Environment source (defaults to `process.env`); injectable for tests.
 */
export function resolveConfig(
  opts: GlobalOptions,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedConfig {
  const rawUrl = opts.apiUrl ?? env.SETTLEKIT_API_URL ?? DEFAULT_API_URL;
  const apiKey = opts.apiKey ?? env.SETTLEKIT_API_KEY;

  return {
    baseUrl: normalizeBaseUrl(rawUrl),
    apiKey: apiKey && apiKey.length > 0 ? apiKey : undefined,
    json: Boolean(opts.json),
  };
}

/**
 * Resolve config and assert that an API key is present.
 *
 * @throws Error with an actionable message when no key is configured.
 */
export function requireConfig(
  opts: GlobalOptions,
  env: NodeJS.ProcessEnv = process.env,
): Required<Pick<ResolvedConfig, "apiKey">> & ResolvedConfig {
  const cfg = resolveConfig(opts, env);
  if (!cfg.apiKey) {
    throw new Error(
      "No API key configured. Pass --api-key <key> or set SETTLEKIT_API_KEY.",
    );
  }
  return { ...cfg, apiKey: cfg.apiKey };
}
