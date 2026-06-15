/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The @settlekit/* workspace packages ship as ESM TypeScript-built JS;
  // transpile them so they are bundled with the app's module graph.
  transpilePackages: [
    "@settlekit/common",
    "@settlekit/database",
    "@settlekit/delivery",
    "@settlekit/entitlements",
    "@settlekit/risk",
    "@settlekit/webhooks",
  ],
  experimental: {
    // postgres-js is a server-only dependency of @settlekit/database.
    serverComponentsExternalPackages: ["postgres"],
  },
};

export default nextConfig;
