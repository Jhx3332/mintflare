import Link from "next/link";

export default function Footer() {
  return (
    <footer className="w-full bg-[var(--background)] border-t border-[var(--border)] py-8 sm:py-12 mt-16">
      <div className="max-w-7xl mx-auto px-4">
        <p className="text-xs sm:text-sm text-neutral-400 mb-6 leading-relaxed">
          Mintflare.fun is a token creation platform that allows users to generate Solana-based
          tokens instantly, with no coding required. Mintflare.fun does not issue, endorse, manage,
          or provide liquidity for any tokens created using our service. We do not provide financial
          advice, investment recommendations, or guarantees of value, price, or returns on any
          tokens. Tokens created on Mintflare.fun are not securities, and users are solely
          responsible for ensuring compliance with applicable laws and regulations in their
          jurisdiction. Mintflare.fun does not facilitate token trading, fundraising, or liquidity
          provision. By using Mintflare.fun, you acknowledge that creating and trading tokens carry
          significant risks, including loss of funds, market volatility, and regulatory uncertainty.
          Mintflare.fun is provided &quot;as is&quot; without warranties of any kind. We are not
          responsible for any outcomes related to the use of our platform. By using Mintflare.fun,
          you accept full responsibility for your actions and any consequences that may arise.
          Always conduct your own due diligence before engaging with any token or project.
        </p>
        <div className="text-xs sm:text-sm text-neutral-500 flex flex-wrap items-center justify-between">
          <span>© 2026 Mintflare.fun | All Rights Reserved</span>
          <div className="flex gap-4">
            <Link href="/terms-of-use" className="hover:text-white transition-colors">
              Terms of Use
            </Link>
            <span className="text-neutral-500">|</span>
            <Link href="/privacy-policy" className="hover:text-white transition-colors">
              Privacy Policy
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
