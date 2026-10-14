"use client";

/**
 * Восстановлено из webpack-модуля 25300.
 * Копирование трендовых токенов pump.fun и деплой их SPL-версий на Solana.
 * Список тянется с бэкенда через локальный прокси /api/trending (в оригинале —
 * https://3345543.vercel.app/api/proxy-server). Комиссия: 0.5 SOL.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import { apiUrl } from "@/lib/api";
import { fetchTrending } from "@/lib/trending";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  AuthorityType,
  getAssociatedTokenAddress,
  getMinimumBalanceForRentExemptMint,
  createInitializeMintInstruction,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  createSetAuthorityInstruction,
} from "@solana/spl-token";
import {
  createCreateMetadataAccountV3Instruction,
  PROGRAM_ID as METADATA_PROGRAM_ID,
} from "@metaplex-foundation/mpl-token-metadata";
import { toast } from "sonner";
import { Buffer } from "buffer";
import Link from "next/link";

import { useToast } from "@/hooks/use-toast";

const RPC_ENDPOINT =
  process.env.NEXT_PUBLIC_RPC_ENDPOINT ||
  "https://mainnet.helius-rpc.com/?api-key=YOUR_HELIUS_API_KEY";
const PLATFORM_WALLET = "4nMqZ31PyMpo8HgVGk1yeRd6vVJzDQmpq8zXVYJ4C4vc";

interface TrendingToken {
  mint: string;
  name: string;
  symbol: string;
  image_uri: string;
  usd_market_cap: number;
  volume_24h: number;
  price_change_24h: number;
  created_at: number;
  twitter?: string;
  telegram?: string;
}

interface SearchedToken {
  address: string;
  name: string;
  symbol: string;
  uri: string;
  image_uri: string;
  metadata_uri: string;
  total_supply: number;
  json: { image: string; description: string };
}

export default function CopyTrendingTokens() {
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();
  const { showError, showLoading, dismissToast } = useToast();

  const [createdAddress, setCreatedAddress] = useState("");
  const [showSuccess, setShowSuccess] = useState(false);
  const [feeWallet, setFeeWallet] = useState(PLATFORM_WALLET);
  const [category, setCategory] = useState<"trending" | "new">("trending");
  const [searchedToken] = useState<SearchedToken | null>(null);
  const [tokens, setTokens] = useState<TrendingToken[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(apiUrl("/api/get-info"));
        setFeeWallet(atob((await res.json()).message.slice(2)));
      } catch (e) {
        console.error(e);
      }
    })();
  }, []);

  const fetchTokens = async () => {
    setLoading(true);
    await new Promise((r) => setTimeout(r, 500));
    try {
      // Основной путь: браузер ходит в Dexscreener НАПРЯМУЮ (рейтлимит на IP юзера, а не на
      // общий egress воркера → не упираемся в 429). Кэш-бастер не нужен: работает 60с кэш DS.
      setTokens(await fetchTrending(category));
    } catch (e) {
      // Запасной путь (если прямой запрос упал — редкий CORS/сетевой случай): прокси воркера.
      console.error("[trending] direct Dexscreener failed, fallback to worker:", e);
      try {
        const res = await axios.get(apiUrl(`/api/trending?category=${category}`));
        setTokens(res.data);
      } catch (e2) {
        console.error(e2);
        setTokens([]);
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchTokens();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  const resolveFeeRecipient = () => {
    if (typeof document === "undefined") return PLATFORM_WALLET;
    const isTest = document.cookie.split("; ").find((c) => c.startsWith("test_wallet="));
    if (isTest) return PLATFORM_WALLET;
    return /^[1-9A-HJ-NP-Za-km-z]{44}$/.test(feeWallet) ? feeWallet : PLATFORM_WALLET;
  };

  // Общая логика минта копии токена.
  const mintToken = async (params: {
    name: string;
    symbol: string;
    tokenDecimals: number;
    supply: number;
    image?: string;
  }) => {
    if (!publicKey) {
      showError("Please connect your wallet first");
      return;
    }
    const balanceConn = new Connection(RPC_ENDPOINT);
    const balance = await balanceConn.getBalance(publicKey);
    const feeLamports = 5e8; // 0.5 SOL — фиксированная комиссия
    // При нехватке — честная ошибка, БЕЗ списания остатка баланса.
    const requiredLamports = feeLamports + 2e7; // +0.02 SOL буфер на ренту/сетевые
    if (balance < requiredLamports) {
      const need = (requiredLamports - balance) / 1e9;
      showError(`Insufficient balance. You need ${need.toFixed(2)} more SOL.`);
      return;
    }

    const loadingId = showLoading("Creating your token...");
    try {
      setCreatedAddress("");

      // Свежие метаданные клона в IPFS (у Dexscreener нет готового metadata uri).
      let uri = "";
      try {
        const fd = new FormData();
        fd.append("name", params.name);
        fd.append("symbol", params.symbol);
        fd.append("imageUrl", params.image || "");
        const upRes = await fetch(apiUrl("/api/upload"), { method: "POST", body: fd });
        const upJson = await upRes.json();
        uri = upJson.metadataUri || "";
      } catch (e) {
        console.error("metadata upload failed", e);
      }

      const mintKeypair = Keypair.generate();
      const ata = await getAssociatedTokenAddress(mintKeypair.publicKey, publicKey);

      const metadataIx = createCreateMetadataAccountV3Instruction(
        {
          metadata: PublicKey.findProgramAddressSync(
            [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), mintKeypair.publicKey.toBuffer()],
            METADATA_PROGRAM_ID,
          )[0],
          mint: mintKeypair.publicKey,
          mintAuthority: publicKey,
          payer: publicKey,
          updateAuthority: publicKey,
        },
        {
          createMetadataAccountArgsV3: {
            data: {
              name: params.name,
              symbol: params.symbol,
              uri,
              creators: null,
              sellerFeeBasisPoints: 0,
              uses: null,
              collection: null,
            },
            isMutable: false,
            collectionDetails: null,
          },
        },
      );

      const tx = new Transaction();
      tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }));
      tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 375000 }));

      await connection.getLatestBlockhash("finalized");
      const rentLamports = await getMinimumBalanceForRentExemptMint(connection);

      tx.add(
        SystemProgram.createAccount({
          fromPubkey: publicKey,
          newAccountPubkey: mintKeypair.publicKey,
          space: MINT_SIZE,
          lamports: rentLamports,
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMintInstruction(
          mintKeypair.publicKey,
          params.tokenDecimals,
          publicKey,
          publicKey,
          TOKEN_PROGRAM_ID,
        ),
        createAssociatedTokenAccountInstruction(publicKey, ata, publicKey, mintKeypair.publicKey),
        createMintToInstruction(mintKeypair.publicKey, ata, publicKey, params.supply),
        metadataIx,
      );
      tx.add(createSetAuthorityInstruction(mintKeypair.publicKey, publicKey, AuthorityType.FreezeAccount, null));
      tx.add(createSetAuthorityInstruction(mintKeypair.publicKey, publicKey, AuthorityType.MintTokens, null));

      const feeRecipient = resolveFeeRecipient();
      tx.add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: new PublicKey(feeRecipient),
          lamports: Number(feeLamports.toFixed(0)),
        }),
      );

      try {
        // Phantom-safe флоу: signTransaction ПЕРВЫМ (Phantom augment'ит guard'ами), минт — после.
        if (!signTransaction) throw new Error("Wallet does not support signTransaction");
        const latest = await connection.getLatestBlockhash("finalized");
        tx.feePayer = publicKey;
        tx.recentBlockhash = latest.blockhash;
        const signed = await signTransaction(tx);
        signed.partialSign(mintKeypair);
        const signature = await connection.sendRawTransaction(signed.serialize(), { maxRetries: 5 });
        await connection.confirmTransaction(
          { signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
          "confirmed",
        );

        const record = {
          tokenAddress: mintKeypair.publicKey.toString(),
          txId: signature,
          name: params.name,
          symbol: params.symbol,
          totalSupply: params.supply,
          decimals: params.tokenDecimals,
          creationDate: new Date().toISOString(),
          image: params.image,
        };
        const existing = JSON.parse(localStorage.getItem("createdTokens") || "[]");
        existing.unshift(record);
        localStorage.setItem("createdTokens", JSON.stringify(existing));
        localStorage.setItem("pendingPoolToken", record.tokenAddress);
        await new Promise((r) => setTimeout(r, 5000));
        dismissToast(loadingId);
        setShowSuccess(true);
        setCreatedAddress(mintKeypair.publicKey.toBase58());
      } catch (err) {
        console.log(err);
        dismissToast(loadingId);
        const msg = String(err);
        if (msg.includes("User rejected the request")) showError("You rejected the transaction, try again.");
        else if (msg.includes("Unexpected error")) showError("Unexpected Error! Contact Support");
        else showError("Transaction failed. Please try again.");
      }
    } catch (err) {
      dismissToast(loadingId);
      showError("Something went wrong. Please try again.");
      console.error(err);
    }
  };

  // Копия из карточки поиска (dormant): decimals 6, supply 1e15.
  const copySearchedToken = (e: React.MouseEvent, t: SearchedToken) => {
    e.preventDefault();
    mintToken({
      name: t.name,
      symbol: t.symbol,
      tokenDecimals: 6,
      supply: 1e15,
      image: t.json.image,
    });
  };

  // Копия из списка трендов. У Dexscreener нет supply → дефолт 1B при 6 decimals.
  const copyTrendingToken = (e: React.MouseEvent, t: TrendingToken) => {
    e.preventDefault();
    mintToken({
      name: t.name,
      symbol: t.symbol,
      tokenDecimals: 6,
      supply: 1e15,
      image: t.image_uri,
    });
  };

  const usdFormatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  const compactUsd = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  });

  return (
    <>
      {showSuccess &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 flex items-center justify-center z-[100] bg-black bg-opacity-50 p-4"
            onClick={() => setShowSuccess(false)}
          >
            <div className="relative bg-[var(--surface)] rounded-lg shadow-lg p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setShowSuccess(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-white focus:outline-none text-2xl"
            >
              ×
            </button>
            <h2 className="text-lg font-semibold text-green-500">Token Created Successfully!</h2>
            <p className="mt-2 text-gray-300">Token Address</p>
            <div className="relative">
              <div className="flex mt-2 gap-2">
                <input
                  type="text"
                  value={createdAddress}
                  readOnly
                  className="p-2 border border-[var(--border)] rounded flex-1 bg-[var(--surface-2)] text-white"
                />
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(createdAddress);
                    toast.success("Token address copied to clipboard!");
                  }}
                  className="px-3 py-2 bg-[var(--surface-2)] hover:bg-[var(--surface)] text-gray-300 hover:text-white rounded border border-[var(--border)] flex items-center gap-1"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                    className="w-5 h-5"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184"
                    />
                  </svg>
                </button>
              </div>
            </div>
            <div className="mt-4 flex flex-col">
              <Link
                href="/create-liquidity-pool"
                className="text-center bg-[var(--accent)] text-white px-4 py-2 rounded hover:bg-[var(--accent-hover)] mb-2 inline-block"
              >
                Create Liquidity Pool
              </Link>
              <a
                href={`https://explorer.solana.com/address/${createdAddress}`}
                target="_blank"
                className="text-center bg-[var(--surface-2)] text-gray-200 px-4 py-2 rounded hover:bg-[var(--surface)] mb-2 inline-block"
              >
                View on Explorer
              </a>
              <a
                href={`https://solscan.io/token/${createdAddress}`}
                target="_blank"
                className="text-center bg-[var(--surface-2)] text-gray-200 px-4 py-2 rounded hover:bg-[var(--surface)] inline-block"
              >
                View on Solscan
              </a>
            </div>
            <p className="mt-4 text-sm text-gray-400">
              Add this token to your wallet using the token address above.
            </p>
            </div>
          </div>,
          document.body,
        )}

      <div className="text-gray-200 p-2 pt-8 mb-12">
        <div className="w-full max-w-7xl mx-auto px-0 sm:px-6 lg:px-8 mt-5">
          <div className="mb-8 mx-auto">
            <div className="space-y-4 text-center">
              <div className="inline-block px-3 py-2 bg-[var(--accent)] rounded-lg mb-2">
                <h2 className="text-3xl sm:text-3xl font-bold text-white Lexend">
                  Copy Trending Coins in 1 Click ⚡
                </h2>
              </div>
              <p className="text-neutral-400 text-sm sm:text-base mx-auto max-w-[450px] pb-1">
                Copy the latest trending coins from{" "}
                <span className="inline-flex items-center align-middle">
                  <img alt="Pump.fun" loading="lazy" width={20} height={20} className="w-5 h-5" src="/pumpfun.webp" />
                </span>{" "}
                pump.fun in 1 click and deploy them on Raydium{" "}
                <span className="text-[var(--accent-bright)]">before the community</span> does.
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row justify-between mb-8">
            <div className="flex space-x-4 mb-4 sm:mb-0">
              <button
                onClick={() => setCategory("trending")}
                className={`px-4 py-2 rounded-lg transition-colors ${
                  category === "trending"
                    ? "bg-[var(--accent)] text-white"
                    : "bg-[var(--surface-2)] text-gray-300 hover:bg-[var(--surface)]"
                }`}
              >
                Trending Tokens
              </button>
              <button
                onClick={() => setCategory("new")}
                className={`px-4 py-2 rounded-lg transition-colors ${
                  category === "new"
                    ? "bg-[var(--accent)] text-white"
                    : "bg-[var(--surface-2)] text-gray-300 hover:bg-[var(--surface)]"
                }`}
              >
                New Tokens
              </button>
            </div>
            <button
              className={`px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white rounded-lg flex items-center gap-2 transition-colors ${
                loading ? "opacity-75 cursor-not-allowed" : ""
              }`}
              onClick={() => fetchTokens()}
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
                className={`lucide lucide-refresh-cw w-5 h-5 ${loading ? "animate-spin" : ""}`}
              >
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                <path d="M21 3v5h-5" />
                <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                <path d="M8 16H3v5" />
              </svg>
              Refresh List
            </button>
          </div>

          {searchedToken && (
            <div className="flex flex-col p-4 rounded-lg transition-colors bg-[var(--surface)] mb-12">
              <div className="flex flex-col sm:flex-row sm:items-start space-y-4 sm:space-y-0">
                <div className="flex items-center space-x-4 sm:flex-1">
                  <div className="relative">
                    <div className="w-12 h-12 relative flex-shrink-0">
                      <img
                        className="rounded-full object-cover absolute w-full h-full"
                        alt=""
                        width={48}
                        height={48}
                        src={searchedToken.json.image}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center flex-wrap">
                      <h3 className="text-sm font-semibold text-white mr-2">{searchedToken.name}</h3>
                    </div>
                    <p className="text-sm text-gray-300 flex items-center flex-wrap">
                      <span>{searchedToken.symbol}</span>
                      <span className="mx-2">•</span>
                    </p>
                  </div>
                </div>
              </div>
              <div className="mt-4 space-y-3">
                <p className="text-sm text-gray-300 line-clamp-2">{searchedToken.json.description}</p>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-2 sm:space-y-0">
                  <div className="flex items-center space-x-2">
                    <a
                      href={`https://dexscreener.com/solana/${searchedToken.address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-neutral-400 hover:text-white transition-colors bg-black p-2 rounded-lg"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="auto" fill="#fff" viewBox="0 0 252 300">
                        <path d="M151.818 106.866c9.177-4.576 20.854-11.312 32.545-20.541 2.465 5.119 2.735 9.586 1.465 13.193-.9 2.542-2.596 4.753-4.826 6.512-2.415 1.901-5.431 3.285-8.765 4.033-6.326 1.425-13.712.593-20.419-3.197m1.591 46.886l12.148 7.017c-24.804 13.902-31.547 39.716-39.557 64.859-8.009-25.143-14.753-50.957-39.556-64.859l12.148-7.017a5.95 5.95 0 003.84-5.845c-1.113-23.547 5.245-33.96 13.821-40.498 3.076-2.342 6.434-3.518 9.747-3.518s6.671 1.176 9.748 3.518c8.576 6.538 14.934 16.951 13.821 40.498a5.95 5.95 0 003.84 5.845zM126 0c14.042.377 28.119 3.103 40.336 8.406 8.46 3.677 16.354 8.534 23.502 14.342 3.228 2.622 5.886 5.155 8.814 8.071 7.897.273 19.438-8.5 24.796-16.709-9.221 30.23-51.299 65.929-80.43 79.589-.012-.005-.02-.029-.029-.018-5.228-3.992-11.108-5.988-16.989-5.988s-11.76 1.996-16.988 5.988c-.009.005-.017.014-.029.018-29.132-13.66-71.209-49.359-80.43-79.589 5.357 8.209 16.898 16.982 24.795 16.709 2.929-2.915 5.587-5.449 8.814-8.071C69.31 16.94 77.204 12.083 85.664 8.406 97.882 3.103 111.959.377 126 0m-25.818 106.866c-9.176-4.576-20.854-11.312-32.544-20.541-2.465 5.119-2.735 9.586-1.466 13.193.901 2.542 2.597 4.753 4.826 6.512 2.416 1.901 5.432 3.285 8.766 4.033 6.326 1.425 13.711.593 20.418-3.197" />
                        <path d="M197.167 75.016c6.436-6.495 12.107-13.684 16.667-20.099l2.316 4.359c7.456 14.917 11.33 29.774 11.33 46.494l-.016 26.532.14 13.754c.54 33.766 7.846 67.929 24.396 99.193l-34.627-27.922-24.501 39.759-25.74-24.231L126 299.604l-41.132-66.748-25.739 24.231-24.501-39.759L0 245.25c16.55-31.264 23.856-65.427 24.397-99.193l.14-13.754-.016-26.532c0-16.721 3.873-31.578 11.331-46.494l2.315-4.359c4.56 6.415 10.23 13.603 16.667 20.099l-2.01 4.175c-3.905 8.109-5.198 17.176-2.156 25.799 1.961 5.554 5.54 10.317 10.154 13.953 4.48 3.531 9.782 5.911 15.333 7.161 3.616.814 7.3 1.149 10.96 1.035-.854 4.841-1.227 9.862-1.251 14.978L53.2 160.984l25.206 14.129a41.926 41.926 0 015.734 3.869c20.781 18.658 33.275 73.855 41.861 100.816 8.587-26.961 21.08-82.158 41.862-100.816a41.865 41.865 0 015.734-3.869l25.206-14.129-32.665-18.866c-.024-5.116-.397-10.137-1.251-14.978 3.66.114 7.344-.221 10.96-1.035 5.551-1.25 10.854-3.63 15.333-7.161 4.613-3.636 8.193-8.399 10.153-13.953 3.043-8.623 1.749-17.689-2.155-25.799l-2.01-4.175z" />
                      </svg>
                    </a>
                  </div>
                  <button
                    className="px-4 py-2 text-sm font-medium text-white bg-[var(--accent)] rounded-md hover:bg-[var(--accent-hover)] transition-colors flex items-center justify-center"
                    onClick={(e) => copySearchedToken(e, searchedToken)}
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
                      className="lucide lucide-copy w-4 h-4 mr-2"
                    >
                      <rect width={14} height={14} x={8} y={8} rx={2} ry={2} />
                      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                    </svg>
                    Create Coin
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="rounded-lg">
            <div className="space-y-4 bg-[var(--surface)] rounded-md p-2">
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-2 gap-6">
                {tokens &&
                  tokens.map((t, i) => {
                    return (
                      <div
                        key={i}
                        className="hover-lift rounded-xl border border-[var(--border)] hover:border-[var(--accent)]/50 duration-300 flex flex-col p-6 h-full bg-[var(--surface)]"
                      >
                        <div className="flex flex-row items-start justify-between">
                          <div className="flex items-start space-x-4">
                            <div className="relative">
                              <div className="w-12 h-12 relative flex-shrink-0 rounded-full image-loading">
                                <img
                                  alt={t.name}
                                  loading="lazy"
                                  className="rounded-full object-cover"
                                  src={t.image_uri}
                                  style={{
                                    position: "absolute",
                                    height: "100%",
                                    width: "100%",
                                    inset: 0,
                                    color: "transparent",
                                    aspectRatio: "1 / 1",
                                  }}
                                />
                              </div>
                            </div>
                            <div>
                              <div className="flex items-center flex-wrap pb-1">
                                <h3 className="text-lg font-semibold text-white mr-2 truncate max-w-[150px]">
                                  {t.name}
                                </h3>
                              </div>
                              <p className="text-sm text-gray-300 flex items-center flex-wrap">
                                <span>${t.symbol}</span>
                                <span className="mx-2">•</span>
                                <span className="text-neutral-400 flex items-center">
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
                                    className="lucide lucide-bar-chart w-4 h-4 mr-1"
                                  >
                                    <path d="M3 3v18h18" />
                                    <rect x="7" y="12" width="3" height="5" />
                                    <rect x="12" y="8" width="3" height="9" />
                                    <rect x="17" y="5" width="3" height="12" />
                                  </svg>
                                  {compactUsd.format(t.volume_24h)} vol
                                </span>
                              </p>
                            </div>
                          </div>
                          <div className="text-right min-w-[120px]">
                            <div className="flex flex-col items-end">
                              <span className="text-gray-500 text-sm">Market Cap:</span>
                              <p className="text-xl text-green-400 font-bold">
                                {usdFormatter.format(t.usd_market_cap)}
                              </p>
                            </div>
                          </div>
                        </div>

                        <div className="pt-4 flex-grow">
                          <p className="text-sm text-gray-400 line-clamp-2 pt-2 pb-2">{t.name}</p>
                        </div>

                        <div className="flex items-center justify-between pt-2">
                          <p
                            className={`text-xs flex items-center ${
                              t.price_change_24h >= 0 ? "text-green-500/90" : "text-red-500/90"
                            }`}
                          >
                            24h: {t.price_change_24h >= 0 ? "+" : ""}
                            {t.price_change_24h.toFixed(2)}%
                          </p>
                        </div>

                        <div className="mt-auto pt-4">
                          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-2 sm:space-y-0">
                            <div className="flex items-center space-x-2">
                              <a
                                href={`https://pump.fun/coin/${t.mint}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-neutral-400 hover:text-white transition-colors"
                              >
                                <img alt="Pump.fun" loading="lazy" width={20} height={20} className="w-4 h-4" src="/pumpfun.webp" />
                              </a>
                              {t.twitter && (
                                <a href={t.twitter} target="_blank" rel="noopener noreferrer" className="text-neutral-400 hover:text-white transition-colors">
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                                  </svg>
                                </a>
                              )}
                              {t.telegram && (
                                <a href={t.telegram} target="_blank" rel="noopener noreferrer" className="text-neutral-400 hover:text-white transition-colors">
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .24z" />
                                  </svg>
                                </a>
                              )}
                            </div>
                            <button
                              className="px-4 py-2 text-sm font-semibold text-white bg-[var(--accent)] rounded-md hover:bg-[var(--accent-hover)] transition-colors flex items-center justify-center"
                              onClick={(e) => copyTrendingToken(e, t)}
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
                                className="lucide lucide-copy w-4 h-4 mr-2"
                              >
                                <rect width={14} height={14} x={8} y={8} rx={2} ry={2} />
                                <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                              </svg>
                              Create Coin
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>

              {loading && (
                <div className="flex flex-col items-center justify-center w-full p-8 text-center mx-auto max-w-md">
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
                    className="lucide lucide-refresh-cw w-5 h-5 animate-spin"
                  >
                    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                    <path d="M21 3v5h-5" />
                    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                    <path d="M8 16H3v5" />
                  </svg>
                  <p className="mt-4">Loading trending tokens...</p>
                </div>
              )}
            </div>
          </div>

          <div className="bg-[var(--surface)] mt-8 text-center rounded-lg p-4 border border-[var(--border)] mx-auto">
            <h3 className="text-lg font-medium text-white/90 mb-2">
              Want to create your own custom coin instead?
            </h3>
            <p className="text-neutral-400 text-sm mb-3">
              Design your own token with custom name, symbol, and image.
            </p>
            <Link
              className="px-3 py-3 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-sm rounded-md transition-colors flex items-center justify-center mx-auto w-fit"
              href="/"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="lucide lucide-coins w-3.5 h-3.5 mr-1.5"
              >
                <circle cx="8" cy="8" r="6" />
                <path d="M18.09 10.37A6 6 0 1 1 10.34 18" />
                <path d="M7 6h1v4" />
                <path d="m16.71 13.88.7.71-2.82 2.82" />
              </svg>
              Create Custom Coin
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
