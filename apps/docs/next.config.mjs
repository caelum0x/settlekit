import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pin output-file-tracing to this app so trace collection works inside the
  // pnpm monorepo instead of resolving against the workspace root.
  outputFileTracingRoot: __dirname,
  // The docs app type-imports the source-built @settlekit/* workspace packages
  // so its code samples stay bound to the real exports. Transpiling lets Next
  // bundle their ESM output directly.
  transpilePackages: [
    "@settlekit/common",
    "@settlekit/payments",
    "@settlekit/entitlements",
    "@settlekit/x402",
    "@settlekit/saas",
    "@settlekit/license-keys",
    "@settlekit/api-keys",
    "@settlekit/github",
    "@settlekit/bundles",
    "@settlekit/agent-services",
  ],
};

export default nextConfig;
