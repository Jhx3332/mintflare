import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const routes: { path: string; priority: number; freq: "daily" | "weekly" | "monthly" }[] = [
    { path: "", priority: 1, freq: "daily" },
    { path: "/create-liquidity-pool", priority: 0.8, freq: "weekly" },
    { path: "/copy-trending-tokens", priority: 0.8, freq: "daily" },
    { path: "/privacy-policy", priority: 0.3, freq: "monthly" },
    { path: "/terms-of-use", priority: 0.3, freq: "monthly" },
  ];
  return routes.map((r) => ({
    url: `${SITE_URL}${r.path}`,
    lastModified: now,
    changeFrequency: r.freq,
    priority: r.priority,
  }));
}
