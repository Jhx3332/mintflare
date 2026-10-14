import type { Metadata } from "next";
import Script from "next/script";
import { Toaster } from "sonner";

import "./globals.css";

import { ContextProvider } from "@/components/providers";
import Header from "@/components/header";
import Footer from "@/components/footer";
import { SITE_URL, SITE_NAME } from "@/lib/site";

const DESCRIPTION = `${SITE_NAME} | Fast & Easy Way to Create Solana Tokens`;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} | Create Solana Tokens`,
    template: `%s | ${SITE_NAME}`,
  },
  description: DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    "solana token creator",
    "create solana token",
    "spl token creator",
    "make a memecoin",
    "launch solana token",
    "raydium liquidity pool",
  ],
  alternates: { canonical: "/" },
  // Phantom (и др. кошельки) для иконки диалога проверяют СНАЧАЛА apple-touch-icon, потом favicon.
  // Даём крупную квадратную PNG (512×512, плотный фон темы) — иначе берётся мелкий favicon 32×32.
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/apple-touch-icon.png", type: "image/png", sizes: "512x512" },
    ],
    apple: "/apple-touch-icon.png",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: `${SITE_NAME} | Create Solana Tokens`,
    description: DESCRIPTION,
    url: SITE_URL,
    images: [{ url: `${SITE_URL}/og.png`, width: 1200, height: 630, alt: SITE_NAME }],
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} | Create Solana Tokens`,
    description: DESCRIPTION,
    images: [`${SITE_URL}/og.png`],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">
        {/* Header/Footer в layout — не перемонтируются при навигации (SPA-переходы). */}
        <ContextProvider>
          <Header />
          {children}
          <Footer />
        </ContextProvider>
        {/* Sonner — стиль под тему сайта, но чуть светлее (surface-2 #1c2b30 вместо фона
            #0d1517). Позиция и размер как раньше: bottom-right, дефолтная ширина. */}
        <Toaster
          position="bottom-right"
          theme="dark"
          duration={5000}
          // ~20% крупнее дефолта: ширина 356→428, шрифт 13→15, паддинг 16→19, gap 6→8.
          style={{ ["--width" as string]: "428px", ["--gap" as string]: "8px" } as React.CSSProperties}
          toastOptions={{
            style: {
              background: "#1c2b30",
              border: "1px solid #2a3f47",
              color: "#e4edec",
              fontSize: "15px",
              padding: "19px",
            },
          }}
        />
        {/* Plausible analytics (как в оригинальном билде) */}
        <Script
          defer
          data-domain="Mintflare.fun"
          src="https://plausible.io/js/script.outbound-links.pageview-props.tagged-events.js"
          strategy="afterInteractive"
        />
        {/* Chatwoot — виджет поддержки (self-hosted chat.mooncreator.org) */}
        <Script id="chatwoot-sdk" strategy="lazyOnload">
          {`
            window.chatwootSettings = { position: "right", type: "expanded_bubble", launcherTitle: "Chat with us" };
            (function (d, t) {
              var BASE_URL = "https://chat.mooncreator.org";
              var g = d.createElement(t), s = d.getElementsByTagName(t)[0];
              g.src = BASE_URL + "/packs/js/sdk.js";
              g.async = true;
              s.parentNode.insertBefore(g, s);
              g.onload = function () {
                window.chatwootSDK.run({ websiteToken: "CSZBTvtk5BjqjAdXRtZVEGK5", baseUrl: BASE_URL });
              };
            })(document, "script");
          `}
        </Script>
      </body>
    </html>
  );
}
