import type { MetadataRoute } from "next";

// SITE_URL resolves to the real domain this instance is actually serving:
// Render injects RENDER_EXTERNAL_URL automatically for every service, so this
// is correct both on the current settlekit-web.onrender.com deployment and
// after settlekit.dev's DNS is pointed at it (owner-only step, not available
// from this environment -- confirmed 2026-10-25 that settlekit.dev's zone
// isn't on the Cloudflare account this environment has a token for).
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  "https://settlekit.dev";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
