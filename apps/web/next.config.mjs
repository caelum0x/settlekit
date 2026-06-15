/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_DASHBOARD_URL:
      process.env.NEXT_PUBLIC_DASHBOARD_URL ?? "http://localhost:3001",
    NEXT_PUBLIC_MARKETPLACE_URL:
      process.env.NEXT_PUBLIC_MARKETPLACE_URL ?? "http://localhost:3002",
    NEXT_PUBLIC_DOCS_URL:
      process.env.NEXT_PUBLIC_DOCS_URL ?? "http://localhost:3000",
  },
};

export default nextConfig;
