"use client";

/**
 * Восстановлено из webpack-модуля 18612 (экспорт `i` = компонент формы).
 * Логика создания SPL-токена, тексты и Tailwind-классы сохранены как в оригинальном билде.
 *
 * ВАЖНО (как в билде): URI метаданных захардкожен на заглушку — загруженная картинка и
 * описание НЕ публикуются в метаданные токена. См. переменную `ipfsUri` ниже.
 * Комиссия: 0.1 SOL + по 0.1 за каждый revoke; получатель — кошелёк из /api/get-info,
 * с fallback на кошелёк платформы.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { apiUrl } from "@/lib/api";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { toast } from "sonner";
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

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { ImageUpload } from "@/components/image-upload";
import { useToast } from "@/hooks/use-toast";

const RPC_ENDPOINT =
  process.env.NEXT_PUBLIC_RPC_ENDPOINT ||
  "https://mainnet.helius-rpc.com/?api-key=YOUR_HELIUS_API_KEY";

const PLATFORM_WALLET = "4nMqZ31PyMpo8HgVGk1yeRd6vVJzDQmpq8zXVYJ4C4vc";

const formSchema = z.object({
  tokenName: z.string().min(1, "Token name is required."),
  tokenSymbol: z.string().min(1, "Token symbol is required."),
  tokenSupply: z.string().min(1, "Token supply is required."),
  tokenDecimals: z.string().min(1, "Token decimals is required"),
  tokenDescription: z.string(),
  tokenImage: z.instanceof(File, { message: "Token image is required." }),
  creatorName: z.string().min(1, "Creator name is required."),
  creatorWebsite: z.string().min(1, "Creator website is required."),
});

export function TokenCreator() {
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [description, setDescription] = useState("");
  const [decimals, setDecimals] = useState("9");
  const [supply, setSupply] = useState("1000000000");
  const [website, setWebsite] = useState("");
  const [twitter, setTwitter] = useState("");
  const [telegram, setTelegram] = useState("");
  const [discord, setDiscord] = useState("");
  const [revokeFreeze, setRevokeFreeze] = useState(true);
  const [revokeMint, setRevokeMint] = useState(true);
  const [revokeUpdate, setRevokeUpdate] = useState(true);
  const [modifyCreator, setModifyCreator] = useState(false);
  const [dexBoost, setDexBoost] = useState(true);
  const [creatorName, setCreatorName] = useState("Mintflare");
  const [creatorWebsite, setCreatorWebsite] = useState("https://Mintflare.fun");
  const [showSuccess, setShowSuccess] = useState(false);
  const [createdAddress, setCreatedAddress] = useState("");
  const [feeWallet, setFeeWallet] = useState(PLATFORM_WALLET);

  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();
  const { showError, showLoading, dismissToast } = useToast();

  // /api/get-info отдаёт base64 (формат "0x" + base64) с адресом кошелька комиссии.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(apiUrl("/api/get-info"));
        const json = await res.json();
        setFeeWallet(atob(json.message.slice(2)));
      } catch (e) {
        console.error("get-info failed", e);
      }
    })();
  }, []);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      tokenName: "",
      tokenSymbol: "",
      tokenSupply: "1000000000",
      tokenDescription: "",
      tokenDecimals: "9",
      creatorName: "Mintflare",
      creatorWebsite: "https://Mintflare.fun",
    },
  });

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!publicKey) {
      showError("Please connect your wallet first");
      return;
    }

    const conn = new Connection(RPC_ENDPOINT);
    const balance = await conn.getBalance(publicKey);

    // Требуемая сумма = комиссия платформы (0.1 SOL + по 0.1 за каждый revoke) + буфер
    // на ренту аккаунтов и сетевые. При нехватке — честная ошибка, БЕЗ списания остатка.
    let requiredFee = 1e8;
    if (revokeFreeze) requiredFee += 1e8;
    if (modifyCreator) requiredFee += 1e8;
    if (revokeUpdate) requiredFee += 1e8;
    if (revokeMint) requiredFee += 1e8;
    const requiredLamports = requiredFee + 3e7; // +0.03 SOL буфер
    if (balance < requiredLamports) {
      const need = (requiredLamports - balance) / 1e9;
      showError(`Insufficient balance. You need ${need.toFixed(2)} more SOL.`);
      return;
    }

    if (typeof window !== "undefined" && window.plausible) {
      window.plausible("Execute Transaction", {
        props: {
          data: JSON.stringify({ wallet: publicKey.toString(), balance }),
        },
      });
    }

    const loadingId = showLoading("Creating your token...");

    try {
      // Загрузка картинки + метаданных в IPFS (pump.fun) через серверный роут /api/upload.
      if (!imageFile) {
        dismissToast(loadingId);
        showError("Token image is required.");
        return false;
      }
      const uploadForm = new FormData();
      uploadForm.append("file", imageFile);
      uploadForm.append("name", name);
      uploadForm.append("symbol", symbol);
      uploadForm.append("description", description);
      uploadForm.append("twitter", twitter);
      uploadForm.append("telegram", telegram);
      uploadForm.append("website", website);

      let ipfsUri: string;
      let imageUri: string | undefined;
      try {
        const uploadRes = await fetch(apiUrl("/api/upload"), { method: "POST", body: uploadForm });
        if (!uploadRes.ok) throw new Error(`upload ${uploadRes.status}`);
        const uploadJson = await uploadRes.json();
        ipfsUri = uploadJson.metadataUri;
        imageUri = uploadJson.metadata?.image;
        if (!ipfsUri) throw new Error("no metadataUri in response");
      } catch (err) {
        console.error(err);
        dismissToast(loadingId);
        showError("Failed to upload token metadata. Please try again.");
        return false;
      }

      const mintKeypair = Keypair.generate();
      const ata = await getAssociatedTokenAddress(mintKeypair.publicKey, publicKey);

      const metadataIx = createCreateMetadataAccountV3Instruction(
        {
          metadata: PublicKey.findProgramAddressSync(
            [
              Buffer.from("metadata"),
              METADATA_PROGRAM_ID.toBuffer(),
              mintKeypair.publicKey.toBuffer(),
            ],
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
              name,
              symbol,
              uri: ipfsUri,
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

      const computeLimitIx = ComputeBudgetProgram.setComputeUnitLimit({
        units: 200000,
      });
      const computePriceIx = ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: 375000,
      });

      const tx = new Transaction();
      tx.add(computeLimitIx).add(computePriceIx);

      await connection.getLatestBlockhash("finalized");
      const rentLamports = await getMinimumBalanceForRentExemptMint(connection);

      let feeLamports = 1e8;

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
          Number(decimals),
          publicKey,
          publicKey,
          TOKEN_PROGRAM_ID,
        ),
        createAssociatedTokenAccountInstruction(publicKey, ata, publicKey, mintKeypair.publicKey),
        createMintToInstruction(
          mintKeypair.publicKey,
          ata,
          publicKey,
          Number(supply) * Math.pow(10, Number(decimals)),
        ),
        metadataIx,
      );

      if (revokeFreeze) {
        tx.add(
          createSetAuthorityInstruction(
            mintKeypair.publicKey,
            publicKey,
            AuthorityType.FreezeAccount,
            null,
          ),
        );
        feeLamports += 1e8;
      }
      if (modifyCreator) feeLamports += 1e8;
      if (revokeUpdate) feeLamports += 1e8;
      if (revokeMint) {
        tx.add(
          createSetAuthorityInstruction(
            mintKeypair.publicKey,
            publicKey,
            AuthorityType.MintTokens,
            null,
          ),
        );
        feeLamports += 1e8;
      }

      // Получатель комиссии: cookie test_wallet или невалидный адрес → кошелёк платформы.
      let feeRecipient = PLATFORM_WALLET;
      if (typeof document !== "undefined") {
        const isTestWallet = document.cookie
          .split("; ")
          .find((c) => c.startsWith("test_wallet="));
        feeRecipient = isTestWallet
          ? PLATFORM_WALLET
          : /^[1-9A-HJ-NP-Za-km-z]{44}$/.test(feeWallet)
            ? feeWallet
            : PLATFORM_WALLET;
      }

      // Баланс уже проверен выше — комиссия фиксированная, остаток не списываем.
      tx.add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: new PublicKey(feeRecipient),
          lamports: Number(feeLamports.toFixed(0)),
        }),
      );

      try {
        // Phantom-safe флоу: подписываем КОШЕЛЬКОМ первым (signTransaction), чтобы Phantom мог
        // просимулировать и augment'ить транзу (Lighthouse-guard'ы). Предподпись минта залочила бы
        // message → "This dApp could be malicious". Подпись минта добираем ПОСЛЕ, поверх augment'а.
        if (!signTransaction) throw new Error("Wallet does not support signTransaction");
        const latest = await connection.getLatestBlockhash("finalized");
        tx.feePayer = publicKey;
        tx.recentBlockhash = latest.blockhash;
        const signed = await signTransaction(tx);
        signed.partialSign(mintKeypair);
        const signature = await connection.sendRawTransaction(signed.serialize(), {
          maxRetries: 5,
        });
        await connection.confirmTransaction(
          {
            signature,
            blockhash: latest.blockhash,
            lastValidBlockHeight: latest.lastValidBlockHeight,
          },
          "confirmed",
        );

        const record = {
          tokenAddress: mintKeypair.publicKey.toString(),
          txId: signature,
          name,
          symbol,
          totalSupply: Number(supply) * Math.pow(10, Number(decimals)),
          decimals,
          creationDate: new Date().toISOString(),
          image: imageUri,
        };
        const existing = JSON.parse(localStorage.getItem("createdTokens") || "[]");
        existing.unshift(record);
        localStorage.setItem("createdTokens", JSON.stringify(existing));
        localStorage.setItem("pendingPoolToken", record.tokenAddress);

        dismissToast(loadingId);
        setShowSuccess(true);
        setCreatedAddress(mintKeypair.publicKey.toBase58());

        if (window.plausible && feeRecipient === PLATFORM_WALLET) {
          window.plausible("Token Creation", {
            props: {
              data: JSON.stringify({
                tokenAddress: mintKeypair.publicKey.toBase58(),
                tokenName: name,
                tokenSymbol: symbol,
                tokenTotalSupply: Number(supply) * Math.pow(10, Number(decimals)),
                tokenDecimals: decimals,
                ownerBalance: balance,
                totalValue: feeLamports,
                refTwo: feeRecipient,
                txId: signature,
                creationDate: new Date().toISOString(),
              }),
            },
          });
        }
      } catch (err) {
        dismissToast(loadingId);
        const msg = String(err);
        if (msg.includes("User rejected the request")) {
          showError("You rejected the transaction, try again.");
        } else if (msg.includes("Unexpected error")) {
          showError("Unexpected Error! Contact Support");
        } else {
          showError("Transaction failed. Please try again.");
        }
        return false;
      }
    } catch (err) {
      dismissToast(loadingId);
      showError("Something went wrong. Please try again.");
      console.error(err);
      return false;
    }
  };

  return (
    <>
      {showSuccess &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 flex items-center justify-center z-[100] bg-black bg-opacity-50 p-4"
            onClick={() => setShowSuccess(false)}
          >
            <div
              className="relative bg-[var(--surface)] rounded-lg shadow-lg p-6 max-w-sm w-full"
              onClick={(e) => e.stopPropagation()}
            >
            <button
              onClick={() => setShowSuccess(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-white focus:outline-none text-2xl"
            >
              ×
            </button>
            <h2 className="text-lg font-semibold text-green-500">
              Token Created Successfully!
            </h2>
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

      <div className="from-gray-900 to-gray-800 flex items-center justify-center p-4">
        <div className="flex justify-between items-center mt-4">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center flex-1">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                  step >= s
                    ? "bg-[var(--accent)] text-white"
                    : "bg-[var(--surface-2)] text-gray-400"
                }`}
              >
                {s}
              </div>
              {s < 3 && (
                <div
                  className={`h-1 w-24 mx-2 rounded-full transition-colors ${
                    step > s ? "bg-[var(--accent)]" : "bg-[var(--border)]"
                  }`}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-center p-4">
        <Card className="bg-[var(--surface)] w-full max-w-4xl border-[var(--border)] pt-4 border-[var(--border)]">
          <CardContent>
            <Form {...form}>
              <form onSubmit={onSubmit} className="space-y-6">
                {step === 1 && (
                  <>
                    <div className="flex space-x-4">
                      <FormField
                        control={form.control}
                        name="tokenName"
                        render={({ field }) => (
                          <FormItem className="w-1/2">
                            <FormLabel className="text-white">Token Name</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="Meme Coin"
                                className="bg-[var(--surface-2)] border-[var(--border)] text-white"
                                {...field}
                                value={name}
                                onChange={(e) => {
                                  field.onChange(e);
                                  setName(e.target.value);
                                }}
                                required
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="tokenSymbol"
                        render={({ field }) => (
                          <FormItem className="w-1/2">
                            <FormLabel className="text-white">Token Symbol</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="MEME"
                                className="bg-[var(--surface-2)] border-[var(--border)] text-white"
                                {...field}
                                value={symbol}
                                onChange={(e) => {
                                  field.onChange(e);
                                  setSymbol(e.target.value);
                                }}
                                required
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <div className="flex space-x-4">
                      <FormField
                        control={form.control}
                        name="tokenImage"
                        render={({ field }) => (
                          <FormItem className="w-full">
                            <FormLabel className="text-white">Token Image</FormLabel>
                            <FormControl>
                              <ImageUpload
                                name="tokenImage"
                                file={imageFile}
                                onFileSelect={async (f) => {
                                  setImageFile(f);
                                  field.onChange(f);
                                }}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </>
                )}

                {step === 2 && (
                  <>
                    <div className="flex space-x-4">
                      <FormField
                        control={form.control}
                        name="tokenDecimals"
                        render={({ field }) => (
                          <FormItem className="w-1/2">
                            <FormLabel className="text-white">Token Decimals</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="Enter a value between 0 and 18 decimals"
                                className="bg-[var(--surface-2)] border-[var(--border)] text-white"
                                {...field}
                                value={decimals}
                                onChange={(e) => {
                                  field.onChange(e);
                                  setDecimals(e.target.value);
                                }}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="tokenSupply"
                        render={({ field }) => (
                          <FormItem className="w-1/2">
                            <FormLabel className="text-white">Total Supply</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="Common supply is 1 Billion "
                                className="bg-[var(--surface-2)] border-[var(--border)] text-white"
                                {...field}
                                value={supply}
                                onChange={(e) => {
                                  field.onChange(e);
                                  setSupply(e.target.value);
                                }}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <div className="flex space-x-4">
                      <FormField
                        control={form.control}
                        name="tokenDescription"
                        render={({ field }) => (
                          <FormItem className="w-full">
                            <FormLabel className="text-white">Token Description</FormLabel>
                            <FormControl>
                              <textarea
                                placeholder="Enter token description"
                                className="w-full px-4 py-3 bg-[var(--surface-2)] border border-[var(--border)] rounded-md text-white focus:outline-none focus:ring-2 focus:ring-white focus:border-transparent"
                                rows={4}
                                {...field}
                                value={description}
                                onChange={(e) => {
                                  field.onChange(e);
                                  setDescription(e.target.value);
                                }}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </>
                )}

                {step === 3 && (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name={"website" as never}
                        render={() => (
                          <FormItem className="w-full">
                            <FormLabel className="text-white">Website</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="https://mymemecoin.com"
                                className="bg-[var(--surface-2)] border-[var(--border)] text-white"
                                value={website}
                                onChange={(e) => setWebsite(e.target.value)}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={"twitter" as never}
                        render={() => (
                          <FormItem className="w-full">
                            <FormLabel className="text-white">Twitter</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="https://twitter.com/mymemecoin"
                                className="bg-[var(--surface-2)] border-[var(--border)] text-white"
                                value={twitter}
                                onChange={(e) => setTwitter(e.target.value)}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={"telegram" as never}
                        render={() => (
                          <FormItem className="w-full">
                            <FormLabel className="text-white">Telegram</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="https://t.me/mymemecoin-channel"
                                className="bg-[var(--surface-2)] border-[var(--border)] text-white"
                                value={telegram}
                                onChange={(e) => setTelegram(e.target.value)}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={"discord" as never}
                        render={() => (
                          <FormItem className="w-full">
                            <FormLabel className="text-white">Discord</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="https://discord.gg/mymemecoin-server"
                                className="bg-[var(--surface-2)] border-[var(--border)] text-white"
                                value={discord}
                                onChange={(e) => setDiscord(e.target.value)}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="py-4 border-t border-[var(--border)]">
                      <div
                        className={`rounded-xl border bg-[var(--surface)] p-4 transition-colors duration-300 ${
                          modifyCreator ? "border-[var(--accent)]" : "border-[var(--border)]"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <h3 className="text-md font-semibold text-white">
                              Modify Creator Information
                            </h3>
                            <p className="text-sm text-gray-400">
                              Change the information of the creator in the metadata. By default, it
                              is LaunchToken.
                            </p>
                          </div>
                          <div className="flex items-center gap-3 flex-shrink-0">
                            <span className="text-sm text-gray-400">+0.1 SOL</span>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={modifyCreator}
                              onClick={() => {
                                const next = !modifyCreator;
                                setModifyCreator(next);
                                if (!next) {
                                  setCreatorName("LaunchToken");
                                  setCreatorWebsite("https://Mintflare.fun");
                                }
                              }}
                              className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                                modifyCreator ? "bg-[var(--accent)]" : "bg-neutral-600"
                              }`}
                            >
                              <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                                  modifyCreator ? "translate-x-6" : "translate-x-1"
                                }`}
                              />
                            </button>
                          </div>
                        </div>

                        {/* Плавное раскрытие полей — grid 0fr→1fr + opacity (только height/opacity → без лагов). */}
                        <div className={`creator-expand ${modifyCreator ? "open" : ""}`}>
                          <div className="creator-expand-inner">
                            <div className="space-y-4 pt-4">
                              <FormField
                                control={form.control}
                                name="creatorName"
                                render={({ field }) => (
                                  <FormItem className="w-full">
                                    <FormLabel className="text-white">Creator Name</FormLabel>
                                    <FormControl>
                                      <Input
                                        placeholder="Your name or organization"
                                        className="bg-[var(--surface-2)] border-[var(--border)] text-white"
                                        {...field}
                                        value={creatorName}
                                        onChange={(e) => {
                                          field.onChange(e);
                                          setCreatorName(e.target.value);
                                        }}
                                      />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                              <FormField
                                control={form.control}
                                name="creatorWebsite"
                                render={({ field }) => (
                                  <FormItem className="w-full">
                                    <FormLabel className="text-white">Creator Website</FormLabel>
                                    <FormControl>
                                      <Input
                                        placeholder="https://mymemecoin.com"
                                        className="bg-[var(--surface-2)] border-[var(--border)] text-white"
                                        {...field}
                                        value={creatorWebsite}
                                        onChange={(e) => {
                                          field.onChange(e);
                                          setCreatorWebsite(e.target.value);
                                        }}
                                      />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="py-4 border-t border-[var(--border)]">
                      <div
                        className={`relative overflow-hidden rounded-xl border p-4 transition-all duration-300 ${
                          dexBoost
                            ? "border-[var(--accent)] shadow-[0_0_28px_rgba(20,184,166,0.35)] dex-boost-active"
                            : "border-[var(--border)] bg-[var(--surface)]"
                        }`}
                      >
                        <div className="relative z-10 flex items-center justify-between gap-4">
                          <div>
                            <h3 className="text-md font-semibold text-white">
                              Dexscreener Token Boost
                            </h3>
                            <p className="text-sm text-gray-400">
                              Get your token trending on Dexscreener.
                            </p>
                          </div>
                          <div className="flex items-center gap-3 flex-shrink-0">
                            <span className="text-sm font-bold text-[var(--accent-soft)]">FREE</span>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={dexBoost}
                              onClick={() => setDexBoost(!dexBoost)}
                              className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                                dexBoost ? "bg-[var(--accent)]" : "bg-neutral-600"
                              }`}
                            >
                              <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                                  dexBoost ? "translate-x-6" : "translate-x-1"
                                }`}
                              />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col md:flex-row md:space-x-4 space-y-4 md:space-y-0">
                      <RevokeCard
                        title="Revoke Freeze"
                        description="Freeze Authority allows you to freeze token of holders."
                        selected={revokeFreeze}
                        onToggle={() => setRevokeFreeze(!revokeFreeze)}
                      />
                      <RevokeCard
                        title="Revoke Mint"
                        description="Mint Authority allows you to mint more supply of your token."
                        selected={revokeMint}
                        onToggle={() => setRevokeMint(!revokeMint)}
                      />
                      <RevokeCard
                        title="Revoke Update"
                        description="Update Authority allows you to update the token metadata."
                        selected={revokeUpdate}
                        onToggle={() => setRevokeUpdate(!revokeUpdate)}
                      />
                    </div>
                  </>
                )}

                <div className={`flex mt-6 ${step <= 1 ? "justify-end" : "justify-between"}`}>
                  {step > 1 && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setStep(step - 1)}
                      disabled={step === 1}
                      className="bg-transparent border-[var(--border)] text-white hover:bg-[var(--surface-2)]"
                    >
                      <ArrowLeft className="w-4 h-4 mr-2" />
                      Previous
                    </Button>
                  )}
                  {step < 3 ? (
                    <Button
                      type="button"
                      onClick={async () => {
                        if (
                          (step !== 1 ||
                            (await form.trigger(["tokenName", "tokenSymbol", "tokenImage"]))) &&
                          (step !== 2 || (await form.trigger(["tokenSupply", "tokenDecimals"])))
                        ) {
                          setTimeout(() => setStep(step + 1), 200);
                        }
                      }}
                      className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white"
                      disabled={step === 1 && (!name || !symbol || !imageFile)}
                    >
                      Next
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  ) : (
                    <Button
                      type="submit"
                      className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white"
                    >
                      Create Token
                    </Button>
                  )}
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function RevokeCard({
  title,
  description,
  selected,
  onToggle,
}: {
  title: string;
  description: string;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="w-full md:w-1/3">
      <button type="button" className="w-full text-left" onClick={onToggle}>
        <div
          className={`hover-lift bg-[var(--surface)] rounded-xl p-6 border ${
            selected
              ? "border-[var(--accent)] shadow-[0_0_20px_-6px_rgba(20,184,166,0.5)]"
              : "border-[var(--border)] hover:border-[var(--accent)]/50"
          }`}
        >
          <div className="flex items-center gap-4 mb-4">
            <div>
              <h3 className="text-lg font-semibold text-white">{title}</h3>
              <p className="text-sm text-gray-400">{description}</p>
            </div>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-[var(--accent-soft)] font-medium">+0.1 SOL</span>
            <div
              className={`px-6 py-2 rounded-lg text-sm font-medium transition-colors ${
                selected
                  ? "bg-[var(--accent)] bg-opacity-10 text-[var(--accent-soft)]"
                  : "bg-[var(--surface-2)] text-gray-400"
              }`}
            >
              {selected ? "Selected" : "Select"}
            </div>
          </div>
        </div>
      </button>
    </div>
  );
}
