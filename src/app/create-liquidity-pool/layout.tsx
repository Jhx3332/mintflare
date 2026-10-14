import type { Metadata } from "next";
import { SITE_NAME } from "@/lib/site";

// Серверный layout только ради per-route metadata — клиентская page.tsx не меняется.
export const metadata: Metadata = {
  title: "Create Raydium Liquidity Pool",
  description: `Create and manage a Raydium (CPMM) liquidity pool for your Solana token on ${SITE_NAME}. Add or remove liquidity on-chain in a few clicks.`,
  alternates: { canonical: "/create-liquidity-pool" },
};

export default function CreateLiquidityPoolLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
