// Единый источник URL/имени сайта для метаданных, OG, sitemap, robots.
// Партнёрские деплои переопределяют NEXT_PUBLIC_SITE_URL / NEXT_PUBLIC_SITE_NAME.
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://mintflare.fun"
).replace(/\/$/, "");

export const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME || "Mintflare.fun";
