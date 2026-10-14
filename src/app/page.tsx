import type { Metadata } from "next";
import Faq from "@/components/faq";
import { TokenCreator } from "@/components/token-creator";
import { FAQS, faqPlainText } from "@/lib/faq-data";
import { SITE_NAME } from "@/lib/site";

// Серверный компонент → можно экспортить metadata и вставить JSON-LD.
// Клиентская логика (кошелёк, транзакции) живёт внутри <TokenCreator/>.
export const metadata: Metadata = {
  // title.template не применяется к корневому сегменту — бренд добавляем явно.
  title: `Create Solana Tokens in Seconds | ${SITE_NAME}`,
  description: `Create and launch your own Solana (SPL) token in seconds with ${SITE_NAME}. No coding required — set name, symbol, supply and image, then mint on-chain.`,
  alternates: { canonical: "/" },
};

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQS.map((f) => ({
    "@type": "Question",
    name: f.question,
    acceptedAnswer: { "@type": "Answer", text: faqPlainText(f.answer) },
  })),
};

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <div className="text-gray-200 p-2 pt-8 mb-12">
        <div className="max-w-4xl mx-auto space-y-8">
          <h1 className="animate-fadeInUp text-4xl sm:text-5xl md:text-6xl font-semibold text-white mb-8 text-center">
            Launch Your Own Coin FAST ⚡
          </h1>
          <p
            className="animate-fadeInUp text-gray-400 text-center"
            style={{ animationDelay: "80ms" }}
          >
            Launch your own token on Solana in seconds. No coding required.
          </p>
          <div className="animate-fadeInUp" style={{ animationDelay: "160ms" }}>
            <TokenCreator />
          </div>
        </div>
      </div>

      <div className="bg-[var(--background)]">
        <div className="container mx-auto px-4 py-8">
          <h2 className="text-3xl font-bold text-center mb-8">
            How to use Solana Token Creator
          </h2>
          <div className="max-w-3xl mx-auto">
            <p className="text-gray-300 mb-4">Follow these simple steps:</p>
            <ol className="space-y-3 list-decimal list-inside text-gray-300">
              <li>Connect your Solana wallet.</li>
              <li>Write the name you want for your Token.</li>
              <li>Indicate the symbol (max 8 characters).</li>
              <li>
                Select the decimals quantity (0 for Whitelist Token, 5 for utility token, 9 for meme
                coins).
              </li>
              <li>Write the description you want for your SPL Token.</li>
              <li>Upload the image for your token (PNG).</li>
              <li>Put the supply of your Token.</li>
              <li>Click on Create, accept the transaction, and wait until your token is ready.</li>
            </ol>
          </div>
        </div>
      </div>

      <Faq />
    </>
  );
}
