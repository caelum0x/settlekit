// External app URLs for cross-app navigation. Defaults match the local
// monorepo dev ports; override via NEXT_PUBLIC_* env vars in deployment.

export const links = {
  dashboard: process.env.NEXT_PUBLIC_DASHBOARD_URL ?? "http://localhost:3001",
  marketplace:
    process.env.NEXT_PUBLIC_MARKETPLACE_URL ?? "http://localhost:3002",
  docs: process.env.NEXT_PUBLIC_DOCS_URL ?? "http://localhost:3000",
  github: "https://github.com/settlekit/settlekit",
} as const;

export const internalLinks = {
  home: "/",
  pricing: "/pricing",
  useCases: "/use-cases",
} as const;
