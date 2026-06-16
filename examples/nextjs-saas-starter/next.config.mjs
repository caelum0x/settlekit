/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The example consumes `@settlekit/react` from the monorepo via a
  // `workspace:*` link. Transpiling it lets Next compile the package's
  // source/output alongside the app without extra build steps in the example.
  transpilePackages: ["@settlekit/react"],
};

export default nextConfig;
