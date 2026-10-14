// Единый источник FAQ — используется и для рендера (faq.tsx), и для JSON-LD (FAQPage) на home.
// Ответы бренд-нейтральные («our platform») — работают на любом white-label домене.
export interface FaqItem {
  question: string;
  answer: string; // может содержать HTML (ссылки/<br/>) для UI
}

export const FAQS: FaqItem[] = [
  {
    question: "What is a Solana token creator?",
    answer:
      "A Solana token creator is a no-code tool that lets you create and deploy your own SPL token on the Solana blockchain in seconds. You customize the name, symbol, supply, decimals, description and image, and the token is minted on-chain directly from your connected wallet — no programming required.",
  },
  {
    question: "How do I create a token on Solana?",
    answer:
      "To create a token, connect your Solana wallet, fill out the form (name, symbol, supply, decimals) and upload an image. Then click Create, approve the transaction in your wallet, and your SPL token is minted on the Solana blockchain within seconds.",
  },
  {
    question: "How much does it cost to create a Solana token?",
    answer:
      "Creating a token costs 0.1 SOL plus a small Solana network fee. Optional add-ons each cost an extra 0.1 SOL: revoke Freeze Authority, revoke Mint Authority and revoke Update Authority. Copying a trending token costs 0.5 SOL (all three revokes on). Boosting a token costs 0.35 SOL. Adding liquidity is around 0.3 SOL and removing liquidity is 0.1 SOL.",
  },
  {
    question: "How long does it take to create a token?",
    answer:
      "Only a few seconds. Solana confirms transactions almost instantly, so once you approve the transaction in your wallet, your token is live on-chain right away and you get its address immediately.",
  },
  {
    question: "Do I need any coding skills to create a token?",
    answer:
      "No. The whole process is no-code. If you can fill out a form and approve a wallet transaction, you can launch a token — no Solana development experience, CLI or smart-contract knowledge needed.",
  },
  {
    question: "Which wallets are supported?",
    answer:
      "Any major Solana wallet works. Phantom and Solflare are supported out of the box, and you can connect on both desktop and mobile.",
  },
  {
    question: "What is an SPL token?",
    answer:
      "SPL (Solana Program Library) is Solana's token standard, the equivalent of ERC-20 on Ethereum. Every token you create here is a standard SPL token, so it is compatible with all Solana wallets, DEXs like Raydium, and tools such as Dexscreener and Solscan.",
  },
  {
    question: "How many decimals should my token have?",
    answer:
      "Decimals control how divisible your token is. Common choices: 9 decimals for meme coins (the Solana default), 6 for utility tokens, and 0 for whitelist or NFT-style tokens that should not be split. If unsure, 9 is the safe default.",
  },
  {
    question: "What does revoking mint, freeze and update authority mean?",
    answer:
      "These are optional safety settings buyers look for. Revoking Mint Authority means no new tokens can ever be minted (fixed supply). Revoking Freeze Authority means you can never freeze holders' tokens. Revoking Update Authority means the token metadata can no longer be changed. Revoking them makes your token more trustworthy for traders.",
  },
  {
    question: "Is it safe? Do you take custody of my tokens?",
    answer:
      "No. This is a non-custodial tool — everything happens on-chain from your own wallet, and you sign every transaction yourself. We never hold your funds, your private keys or the tokens you create. You keep full ownership and control at all times.",
  },
  {
    question: "How do I add liquidity and make my token tradeable?",
    answer:
      "After creating your token, open the Create Liquidity Pool page and pair it with SOL to launch a Raydium pool. This makes your token buyable and sellable on decentralized exchanges. Everything is executed on-chain via Raydium. <br/> <br/> You can verify your position any time on <a href='https://raydium.io/portfolio/?position_tab=standard' class='text-blue-500 underline' target='_blank' rel='noopener noreferrer'>Raydium's official pool dashboard</a> (10–15 min delay). Whether you use our platform or Raydium directly, the result is the same: your tokens, your liquidity, fully decentralized.",
  },
  {
    question: "How do I get my token trending on Dexscreener?",
    answer:
      "Once your token has a liquidity pool, visibility comes from trading activity and social reach. You can also use the Boost option to push your token toward the top of Dexscreener's trending list for a set period, maximizing exposure to traders actively scanning for new tokens.",
  },
  {
    question: "Can I create a memecoin on Solana?",
    answer:
      "Yes. Solana is the most popular chain for memecoins thanks to its low fees and fast confirmations. Just set a fun name, symbol and image, pick 9 decimals and your supply, and launch — then add liquidity so people can trade it.",
  },
  {
    question: "How do I add my token to my wallet after creating it?",
    answer:
      "After creation you get your token's mint address. Copy it, open your Solana wallet (Phantom, Solflare, etc.), choose to add or import a token, and paste the address. Your new token will appear in your wallet balance.",
  },
];

// Чистый текст ответа для structured data (без HTML-тегов).
export function faqPlainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
