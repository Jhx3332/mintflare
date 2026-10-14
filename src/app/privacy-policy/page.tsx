import fs from "fs";
import path from "path";

export const metadata = {
  title: "Privacy Policy",
  description: "How we handle your data on our Solana token creation platform.",
  alternates: { canonical: "/privacy-policy" },
};

// Контент восстановлен из статического экспорта privacy-policy.html (src/app/_privacy.html).
// Header/Footer — в layout.
export default function PrivacyPolicy() {
  const html = fs.readFileSync(
    path.join(process.cwd(), "src/app/_privacy.html"),
    "utf8",
  );
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
