import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

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
    // Pin output-file-tracing root to this app so build-trace collection
    // resolves correctly inside the pnpm monorepo (Next 14 nests this key
    // under `experimental`).
    outputFileTracingRoot: __dirname,
  },
};

export default nextConfig;
