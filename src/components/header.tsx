"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

const NAV_ITEMS = [
  { href: "/", label: "Create Coin" },
  { href: "/create-liquidity-pool", label: "Liquidity" },
  { href: "/copy-trending-tokens", label: "Copy Trending", hot: true },
];

export default function Header() {
  const [mounted, setMounted] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <>
      <div className="top-0 left-0 right-0 z-[60] bg-gradient-to-r from-teal-500 to-cyan-600">
        <div className="container mx-auto px-4">
          <div className="py-1.5 text-center text-[9px] leading-none md:text-xs text-white font-bold tracking-wide">
            ⚠️ LAST CHANCE: 0.1 SOL CREATE COIN FEE (BACK TO 0.2 SOL IN 24H)
          </div>
        </div>
      </div>

      <header className="p-2 sm:p-3 border-b border-[var(--border)] relative z-[50]">
        <div className="max-w-5xl mx-auto px-4">
          <div className="relative flex items-center justify-between">
            {/* Лого + мобильный бургер */}
            <div className="flex items-center">
              <button
                className="md:hidden p-2 text-neutral-400 hover:text-white transition-colors mr-1"
                onClick={() => setMobileOpen(!mobileOpen)}
                aria-label="Menu"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width={24}
                  height={24}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="w-6 h-6"
                >
                  <line x1={4} x2={20} y1={12} y2={12} />
                  <line x1={4} x2={20} y1={6} y2={6} />
                  <line x1={4} x2={20} y1={18} y2={18} />
                </svg>
              </button>

              <Link href="/" className="flex items-center">
                <h1 className="cursor-pointer text-xl lg:text-2xl font-bold text-white flex items-center">
                  <img src="/rocket.png" alt="Rocket" width={33} height={33} className="mr-2" />
                  Mint
                  <b className="text-[var(--accent-bright)]">Flare</b>
                </h1>
              </Link>
            </div>

            {/* Центрированная сегмент-навигация (десктоп) */}
            <nav className="hidden md:flex absolute left-1/2 -translate-x-1/2 items-center gap-1">
              {NAV_ITEMS.map((item) => {
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`relative px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 ${
                      active
                        ? "bg-[var(--surface-2)] text-white"
                        : "text-neutral-400 hover:text-white hover:bg-[var(--surface)]"
                    }`}
                  >
                    {item.label}
                    {item.hot && (
                      <span className="absolute -top-2 -right-1.5 bg-red-500 text-white text-[9px] font-bold leading-none px-1.5 py-0.5 rounded-full shadow-[0_0_10px_-1px_rgba(239,68,68,0.7)]">
                        HOT
                      </span>
                    )}
                  </Link>
                );
              })}
            </nav>

            {/* Кошелёк */}
            <div className="flex items-center justify-end">
              <div className="scale-90 sm:scale-100 origin-right">
                {mounted && <WalletMultiButton />}
              </div>
            </div>
          </div>
        </div>

        {/* Мобильное меню */}
        {mobileOpen && (
          <div className="md:hidden absolute top-full left-0 right-0 bg-[var(--background)] border-b border-[var(--border)] z-50 animate-fadeIn">
            <div className="p-4 flex flex-col gap-2" onClick={() => setMobileOpen(false)}>
              {NAV_ITEMS.map((item) => {
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`relative px-4 py-3 text-base font-medium rounded-xl transition-colors ${
                      active
                        ? "bg-[var(--surface-2)] text-white"
                        : "text-neutral-400 hover:bg-[var(--surface)] hover:text-white"
                    }`}
                  >
                    {item.label}
                    {item.hot && (
                      <span className="ml-2 bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full align-middle">
                        HOT
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </header>
    </>
  );
}
