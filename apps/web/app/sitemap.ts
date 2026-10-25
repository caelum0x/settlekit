import type { MetadataRoute } from "next";

// See app/robots.ts for why SITE_URL is resolved this way.
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  "https://settlekit.dev";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const routes = ["", "/pricing", "/proof", "/use-cases", "/docs/integrate"];

  return routes.map((route) => ({
    url: `${SITE_URL}${route}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: route === "" ? 1.0 : 0.7,
  }));
}
