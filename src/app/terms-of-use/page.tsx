import fs from "fs";
import path from "path";

export const metadata = {
  title: "Terms of Use",
  description: "Terms of use for our no-code Solana token creation platform.",
  alternates: { canonical: "/terms-of-use" },
};

// Контент восстановлен из статического экспорта terms-of-use.html (src/app/_terms.html).
// Header/Footer — в layout.
export default function TermsOfUse() {
  const html = fs.readFileSync(
    path.join(process.cwd(), "src/app/_terms.html"),
    "utf8",
  );
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
