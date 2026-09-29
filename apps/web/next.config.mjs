/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_DASHBOARD_URL:
      process.env.NEXT_PUBLIC_DASHBOARD_URL ?? "http://localhost:3001",
    NEXT_PUBLIC_MARKETPLACE_URL:
      process.env.NEXT_PUBLIC_MARKETPLACE_URL ?? "http://localhost:3011",
    NEXT_PUBLIC_DOCS_URL:
      process.env.NEXT_PUBLIC_DOCS_URL ?? "http://localhost:3000",
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787",
    NEXT_PUBLIC_CHECKOUT_URL: process.env.NEXT_PUBLIC_CHECKOUT_URL ?? "http://localhost:3000",
    NEXT_PUBLIC_PLATFORM_FEE_BPS: process.env.NEXT_PUBLIC_PLATFORM_FEE_BPS ?? "100",
    NEXT_PUBLIC_PLATFORM_FEE_FIXED: process.env.NEXT_PUBLIC_PLATFORM_FEE_FIXED ?? "0",
  },
};

export default nextConfig;
