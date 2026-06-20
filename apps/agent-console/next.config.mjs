/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace domain packages ship compiled ESM; transpile them so Next can
  // bundle them into the server runtime without resolution surprises.
  transpilePackages: [
    "@settlekit/agent-services",
    "@settlekit/attribution",
    "@settlekit/citation-toll",
    "@settlekit/common",
  ],
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787",
  },
};

export default nextConfig;
