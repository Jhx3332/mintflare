/** @type {import('next').NextConfig} */
const nextConfig = {
  // Статический экспорт → чистая статика в out/ для Cloudflare Pages.
  // Серверных частей нет: 4 API-ручки вынесены в отдельный Node-бэкенд (см. /server).
  output: "export",
  reactStrictMode: true,
  images: {
    // В статике оптимизатор next/image недоступен — отдаём картинки как есть.
    unoptimized: true,
  },
  webpack: (config) => {
    // Solana / Raydium libs expect some Node polyfills in the browser bundle.
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      path: false,
      crypto: false,
    };
    config.externals = config.externals || [];
    config.externals.push("pino-pretty", "lokijs", "encoding");
    return config;
  },
};

export default nextConfig;
