/**
 * Public origin of this checkout deployment, for absolute links handed to
 * wallets (Solana Pay transaction requests, icons). `CHECKOUT_PUBLIC_URL`
 * wins; otherwise the request's own origin.
 */
export function publicOrigin(request: Request): string {
  const configured = process.env.CHECKOUT_PUBLIC_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  return new URL(request.url).origin;
}
