import type { Metadata } from "next";
import { SITE_NAME } from "@/lib/site";

// Серверный layout только ради per-route metadata — клиентская page.tsx не меняется.
export const metadata: Metadata = {
  title: "Copy Trending Solana Tokens",
  description: `Browse trending Solana tokens and launch your own version in one click with ${SITE_NAME}. Deploy an SPL token and add it to Raydium.`,
  alternates: { canonical: "/copy-trending-tokens" },
};

export default function CopyTrendingTokensLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
