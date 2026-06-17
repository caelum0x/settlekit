import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Monorepo root (two levels up from apps/checkout).
const monorepoRoot = join(__dirname, "..", "..");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The checkout app imports source-built @settlekit/* workspace packages.
  // Transpiling them lets Next bundle their ESM output directly.
  transpilePackages: [
    "@settlekit/common",
    "@settlekit/payments",
    "@settlekit/entitlements",
    "@settlekit/license-keys",
    "@settlekit/api-keys",
    "@settlekit/file-delivery",
    "@settlekit/github",
    "@settlekit/discord",
  ],
  experimental: {
    // Trace from the MONOREPO ROOT, not this app dir — otherwise Next omits the
    // workspace @settlekit/* package files from the serverless function bundle,
    // which 500s at runtime on Vercel ("Cannot find module"). Local `next start`
    // hides this because it uses the full node_modules. (Next 14 nests this key
    // under `experimental`.)
    outputFileTracingRoot: monorepoRoot,
  },
};

export default nextConfig;
