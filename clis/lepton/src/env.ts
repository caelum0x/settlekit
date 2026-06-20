/**
 * Boundary helpers for reading environment / flag configuration.
 *
 * Keeps "is this present?" validation out of the command bodies and produces
 * actionable error messages (mirrors the requireConfig style in apps/cli).
 */

/** Read a required env var, throwing an actionable error when missing/empty. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(
      `${name} is not set. Export ${name} or pass the corresponding flag.`,
    );
  }
  return value;
}

/** Read the Postgres connection string from DATABASE_URL. */
export function requireDatabaseUrl(): string {
  return requireEnv("DATABASE_URL");
}

/**
 * Resolve a secret from a flag first, then an env var. Throws when neither is
 * present so secrets are never silently defaulted on the read path.
 */
export function resolveSecret(
  flag: string | undefined,
  envName: string,
): string {
  if (flag !== undefined && flag.trim() !== "") return flag;
  const fromEnv = process.env[envName];
  if (fromEnv !== undefined && fromEnv.trim() !== "") return fromEnv;
  throw new Error(
    `Missing secret: pass --secret or set ${envName} in the environment.`,
  );
}
