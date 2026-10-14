"use client";

/**
 * Восстановлено из webpack-модуля 23408.
 * Создание/управление пулом ликвидности Raydium CPMM: создать пул, вывести ликвидность,
 * список своих пулов из localStorage (createdPools). Тексты и классы сохранены как в билде.
 *
 * Комиссия площадки: 0.1 SOL tip (txTipConfig) на кошелёк из /api/get-info (fallback — платформа).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { apiUrl } from "@/lib/api";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Buffer } from "buffer";
import {
  Raydium,
  TxVersion,
  Percent,
  CREATE_CPMM_POOL_PROGRAM,
  CREATE_CPMM_POOL_FEE_ACC,
} from "@raydium-io/raydium-sdk-v2";
import BN from "bn.js";

import { useToast } from "@/hooks/use-toast";
import { TokenImage } from "@/components/token-image";

const RPC_ENDPOINT =
  process.env.NEXT_PUBLIC_RPC_ENDPOINT ||
  "https://mainnet.helius-rpc.com/?api-key=YOUR_HELIUS_API_KEY";
const PLATFORM_WALLET = "4nMqZ31PyMpo8HgVGk1yeRd6vVJzDQmpq8zXVYJ4C4vc";
const BOOST_PRICE_SOL = 0.35; // цена буста
const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
// Публичная CPMM Address Lookup Table (общая для создания пулов, содержит стабильные общие
// аккаунты — программа CPMM, WSOL и т.п., НЕ аккаунты конкретного пула). Адрес взят из живой
// on-chain транзы создания пула. Нужна, чтобы v0-транза сжалась и у Phantom осталось место
// дописать Lighthouse-guard'ы (иначе "This dApp could be malicious"). См. PHANTOM-WARNING-analysis.md.
const CPMM_LOOKUP_TABLE = "AcL1Vo8oy1ULiavEcjSUcwfBSForXMudcZvDZy5nzJkU";

// Картинки токенов грузятся клиентски, через <TokenImage> (перебор рабочих ipfs-гейтвеев).
// Раньше шли через воркер /api/img, но ipfs.io 403/CORP → 502; см. @/lib/token-image.

interface CreatedToken {
  tokenAddress: string;
  name: string;
  symbol: string;
  image?: string;
  decimals: number;
  totalSupply: number;
}

interface CreatedPool {
  poolId: string;
  tokenA: string;
  tokenASymbol: string;
  tokenB: string;
  tokenBSymbol: string;
  creationDate: string;
  tokenBQty?: number;
  txId: string;
  poolData?: PoolData;
  image?: string; // картинка токена (для тестового пула — из метаданных)
}

interface PoolData {
  pooledTokenA: string;
  pooledTokenARaw: string;
  pooledTokenBRaw: number;
  lpAmount: BN;
  tokenA: string;
  tokenB: string;
}

// ─── Тестовый (визуальный) пул для отладки страницы ───────────────────────────
// Тестовый пул помечается служебным txId (poolId теперь случайный).
const TEST_POOL_TX = "TEST_TX";

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function randomPoolId(): string {
  let s = "";
  for (let i = 0; i < 44; i++) s += BASE58[Math.floor(Math.random() * BASE58.length)];
  return s;
}

interface TestPoolSpec {
  poolId: string;
  tokenAddress: string;
  name: string;
  symbol: string;
  image: string;
  initialSol: number;
  targetUsd: number;
  seconds: number;
  createdAt: number;
}

function readTestPoolSpec(): TestPoolSpec | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem("testPool");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TestPoolSpec;
  } catch {
    return null;
  }
}

// Значение P/L зависит от прошедшего времени, но пересчитывается только при вызове
// (т.е. при нажатии Refresh) — вебсокета нет. За `seconds` секунд доходит до targetUsd.
// solPrice — цена SOL в USD (WSOL через Helius); targetUsd конвертируется в SOL через неё.
function buildTestPool(spec: TestPoolSpec, solPrice: number): CreatedPool {
  const t = Math.min(1, (Date.now() - spec.createdAt) / (spec.seconds * 1000));
  const pooledSol = spec.initialSol + (spec.targetUsd / solPrice) * t;
  return {
    poolId: spec.poolId,
    tokenA: spec.tokenAddress,
    tokenASymbol: spec.symbol || "TOKEN",
    tokenB: SOL_MINT,
    tokenBSymbol: "SOL",
    creationDate: new Date(spec.createdAt).toISOString(),
    tokenBQty: spec.initialSol,
    txId: TEST_POOL_TX,
    image: spec.image,
    poolData: {
      pooledTokenA: pooledSol.toFixed(2),
      pooledTokenARaw: pooledSol.toFixed(2),
      pooledTokenBRaw: 900_000_000,
      lpAmount: new BN("1000000000"),
      tokenA: SOL_MINT,
      tokenB: spec.tokenAddress,
    },
  };
}

export default function CreateLiquidityPool() {
  const { connection: walletConnection } = useConnection();
  const { publicKey, signAllTransactions, sendTransaction } = useWallet();
  const { showSuccess, showError, showLoading, dismissToast } = useToast();

  const conn = useMemo(() => new Connection(RPC_ENDPOINT), []);

  const [showRemoveModal, setShowRemoveModal] = useState(false);
  const [boostPool, setBoostPool] = useState<CreatedPool | null>(null);
  const [boosting, setBoosting] = useState(false);
  const [createdTokens, setCreatedTokens] = useState<CreatedToken[]>([]);
  const [selectedTokenValue, setSelectedTokenValue] = useState<string | false | null>(null);
  const [selectedToken, setSelectedToken] = useState<CreatedToken | null>(null);
  const [poolCreatedResult, setPoolCreatedResult] = useState<CreatedPool | false>(false);
  const [refreshing, setRefreshing] = useState(false);
  const [mounted, setMounted] = useState(false);

  const [solBalance, setSolBalance] = useState(0);
  const [usdcBalance] = useState(0);
  // Цена SOL в USD (WSOL через Helius). 129 — запасное значение как в оригинальном билде.
  const [solPrice, setSolPrice] = useState(129);
  const solPriceRef = useRef(129);
  const [tokenAAddress, setTokenAAddress] = useState<string | null>(null);
  const [tokenBAddress, setTokenBAddress] = useState(SOL_MINT);
  const [feeWallet, setFeeWallet] = useState(PLATFORM_WALLET);
  const [isRemoving, setIsRemoving] = useState(false);
  const [amountTokenA, setAmountTokenA] = useState<string>("");
  const [amountTokenB, setAmountTokenB] = useState<string>("");
  const [selectedPoolForRemove, setSelectedPoolForRemove] = useState<CreatedPool | false>(false);
  const [removePercent, setRemovePercent] = useState(0);
  const [isCreatingPool, setIsCreatingPool] = useState(false);
  const [pools, setPools] = useState<(CreatedPool | undefined)[]>([]);

  const [tokenBalances, setTokenBalances] = useState<
    Record<string, { name: string; address: string; image?: string; balance: number }>
  >({
    [SOL_MINT]: { name: "SOL", address: SOL_MINT, image: "/solana-sol-logo.png", balance: 0 },
    [USDC_MINT]: { name: "USDC", address: USDC_MINT, image: "/usdc-logo.svg", balance: 0 },
  });

  // /api/get-info → адрес кошелька комиссии
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

  // Цена WSOL в USD через Helius DAS getAsset.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(RPC_ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "sol-price",
            method: "getAsset",
            params: { id: SOL_MINT },
          }),
        });
        const json = await res.json();
        const price = json?.result?.token_info?.price_info?.price_per_token;
        if (typeof price === "number" && price > 0) {
          setSolPrice(price);
          solPriceRef.current = price;
        }
      } catch (e) {
        console.error("SOL price fetch failed", e);
      }
    })();
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Хелпер визуального тестового пула через консоль браузера (доступен и в проде).
  //   addTestPool("<tokenAddress>")                 → initial 2 SOL, 0$ → +1000$ за 60с
  //   addTestPool("<tokenAddress>", 5, 2000, 120)   → initial 5 SOL, до +2000$ за 120с
  // Метаданные (картинка/название) тянутся через Helius getAsset. P/L НЕ растёт сам —
  // обновляется по прошедшему времени только при нажатии Refresh.
  useEffect(() => {
    if (typeof window === "undefined") return;

    window.addTestPool = async (
      tokenAddress?: string,
      initialSol = 2,
      targetUsd = 1000,
      seconds = 60,
    ) => {
      if (!tokenAddress) {
        console.warn(
          '[mintflare] Usage: addTestPool("<tokenAddress>", initialSol?, targetUsd?, seconds?)',
        );
        return;
      }
      // Метаданные токена через Helius DAS getAsset (RPC-ключ уже на клиенте).
      let name = "";
      let symbol = "";
      let image = "";
      try {
        const res = await fetch(RPC_ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "test-pool",
            method: "getAsset",
            params: { id: tokenAddress },
          }),
        });
        const json = await res.json();
        const content = json?.result?.content;
        name = content?.metadata?.name || "";
        symbol = content?.metadata?.symbol || "";
        image =
          content?.links?.image ||
          content?.files?.[0]?.cdn_uri ||
          content?.files?.[0]?.uri ||
          "";
      } catch (e) {
        console.error("[mintflare] метаданные токена не загрузились:", e);
      }

      const spec: TestPoolSpec = {
        poolId: randomPoolId(),
        tokenAddress,
        name,
        symbol,
        image,
        initialSol,
        targetUsd,
        seconds,
        createdAt: Date.now(),
      };
      localStorage.setItem("testPool", JSON.stringify(spec));
      // Имитируем ожидание транзакции (~2с) с лоадингом, как при реальном создании/удалении.
      const loadingId = showLoading("Creating pool...");
      await new Promise((r) => setTimeout(r, 2000));
      dismissToast(loadingId);
      // Показать (P/L ≈ 0), дальше значение подтягивается по нажатию Refresh.
      setPools((prev) => [
        buildTestPool(spec, solPriceRef.current),
        ...prev.filter((p) => p?.txId !== TEST_POOL_TX),
      ]);
      console.log(
        `[mintflare] тестовый пул: ${name || symbol || tokenAddress} | initial ${initialSol} SOL | цель +$${targetUsd} за ${seconds}с (жми Refresh для обновления)`,
      );
      showSuccess("Pool Created Successfully!");
    };

    // Если spec уже есть в localStorage — показать пул сразу при заходе на страницу.
    const existing = readTestPoolSpec();
    if (existing) {
      setPools((prev) => [
        buildTestPool(existing, solPriceRef.current),
        ...prev.filter((p) => p?.txId !== TEST_POOL_TX),
      ]);
    }

    console.log(
      '%c[mintflare] addTestPool("<tokenAddress>", initialSol?, targetUsd?, seconds?) — жми Refresh, чтобы значение обновилось',
      "color:#14b8a6;font-weight:700",
    );
    return () => {
      delete window.addTestPool;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resolveFeeRecipient = () => {
    if (typeof document === "undefined") return PLATFORM_WALLET;
    const isTest = document.cookie.split("; ").find((c) => c.startsWith("test_wallet="));
    if (isTest) return PLATFORM_WALLET;
    return /^[1-9A-HJ-NP-Za-km-z]{44}$/.test(feeWallet) ? feeWallet : PLATFORM_WALLET;
  };

  // Boost: перевод 0.35 SOL на кошелёк комиссии, затем success + отправка адреса токена на эндпоинт из env.
  const handleBoost = async () => {
    if (!publicKey || !boostPool) {
      showError("Please connect your wallet first");
      return;
    }
    const tokenAddress = boostPool.tokenA;
    const balance = await conn.getBalance(publicKey);
    const feeLamports = Math.round(BOOST_PRICE_SOL * LAMPORTS_PER_SOL);
    const requiredLamports = feeLamports + 1e7; // +0.01 SOL буфер на сеть
    if (balance < requiredLamports) {
      const need = (requiredLamports - balance) / LAMPORTS_PER_SOL;
      showError(`Insufficient balance. You need ${need.toFixed(2)} more SOL.`);
      return;
    }

    setBoosting(true);
    const loadingId = showLoading("Boosting your token...");
    try {
      const feeRecipient = resolveFeeRecipient();
      const tx = new Transaction();
      tx.add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: new PublicKey(feeRecipient),
          lamports: feeLamports,
        }),
      );
      const signature = await sendTransaction(tx, conn);
      const latest = await conn.getLatestBlockhash();
      await conn.confirmTransaction(
        { signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
        "confirmed",
      );

      dismissToast(loadingId);
      showSuccess(`Successful! ${tokenAddress}`);

      // Отправляем адрес токена на эндпоинт из env (через серверный прокси /api/boost).
      try {
        await fetch(apiUrl("/api/boost"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tokenAddress, txId: signature }),
        });
      } catch (e) {
        console.error("boost endpoint failed", e);
      }

      setBoostPool(null);
    } catch (err) {
      dismissToast(loadingId);
      const msg = String(err);
      if (msg.includes("User rejected the request")) {
        showError("You rejected the transaction, try again.");
      } else {
        showError("Boost failed. Please try again.");
      }
      console.error(err);
    } finally {
      setBoosting(false);
    }
  };

  const loadRaydium = () =>
    Raydium.load({
      owner: publicKey!,
      connection: conn,
      cluster: "mainnet",
      disableFeatureCheck: true,
      disableLoadToken: false,
      blockhashCommitment: "finalized",
      signAllTransactions,
    });

  const shorten = (a: string) => a.slice(0, 4) + "..." + a.slice(-4);

  const getPoolData = async (poolId: string): Promise<PoolData | null> => {
    let result: PoolData | null = null;
    const raydium = await loadRaydium();
    try {
      const info = await raydium.cpmm.getRpcPoolInfo(poolId);
      if (info.poolCreator.toString() !== publicKey!.toString()) return null;
      result = {
        pooledTokenA: (Number(info.vaultAAmount.toString()) / LAMPORTS_PER_SOL).toFixed(2),
        pooledTokenARaw: (Number(info.vaultAAmount.toString()) / LAMPORTS_PER_SOL).toFixed(2),
        pooledTokenBRaw: Number(info.vaultBAmount.toString()) / 10 ** info.mintDecimalB,
        lpAmount: info.lpAmount,
        tokenA: info.mintA.toString(),
        tokenB: info.mintB.toString(),
      };
    } catch (e) {
      console.log(e);
    }
    return result;
  };

  const extractPools = async (): Promise<(CreatedPool | undefined | null)[]> => {
    const stored: CreatedPool[] = JSON.parse(localStorage.getItem("createdPools") || "[]");
    if (!(stored.length > 0)) return [];
    return Promise.all(
      stored.map(async (pool) => {
        const txId = pool.txId;
        try {
          const parsed = await conn.getParsedTransaction(txId, {
            maxSupportedTransactionVersion: 0,
          });
          if (!parsed || !parsed.meta || !parsed.meta.innerInstructions) {
            console.warn("Transaction details not found for " + txId);
            return;
          }
          const inner = parsed.meta.innerInstructions[0];
          if (!inner || !inner.instructions) {
            console.warn("Inner instructions not found for " + txId);
            return;
          }
          const ix = inner.instructions[12] as unknown as {
            parsed?: { info?: { newAccount?: string } };
          };
          if (!ix || !("parsed" in ix)) {
            console.warn("Pool creation instruction not found for " + txId);
            return;
          }
          if (ix.parsed?.info?.newAccount) {
            const data = await getPoolData(ix.parsed.info.newAccount);
            if (!data || parseFloat(data.pooledTokenA) <= 0) {
              removePoolFromStorage(txId);
              return null;
            }
            return { ...pool, poolId: ix.parsed.info.newAccount, poolData: data };
          }
          return;
        } catch (e) {
          console.error("Error extracting pool ID from transaction " + txId + ":", e);
          return;
        }
      }),
    );
  };

  // Добавляет тестовый пул (если задан) в начало реального списка.
  const withTestPool = (real: (CreatedPool | undefined)[]) => {
    const spec = readTestPoolSpec();
    return spec ? [buildTestPool(spec, solPriceRef.current), ...real] : real;
  };

  const removePoolFromStorage = async (txId: string) => {
    const filtered: CreatedPool[] = JSON.parse(
      localStorage.getItem("createdPools") || "[]",
    ).filter((p: CreatedPool) => p.txId !== txId);
    localStorage.setItem("createdPools", JSON.stringify(filtered));
    setPools(withTestPool((await extractPools()).filter((p) => p !== null) as (CreatedPool | undefined)[]));
  };

  // Баланс SOL + список пулов
  useEffect(() => {
    if (!publicKey) return;
    (async () => {
      setPools(withTestPool((await extractPools()).filter((p) => p !== null) as (CreatedPool | undefined)[]));
    })();
    const loadBalance = async () => {
      await conn.getLatestBlockhash("finalized");
      setSolBalance((await conn.getBalance(publicKey, "confirmed")) / LAMPORTS_PER_SOL);
    };
    loadBalance();
    setTimeout(loadBalance, 5000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey]);

  // Загрузка созданных токенов и их балансов (без авто-выбора).
  useEffect(() => {
    if (!publicKey) return;
    const stored: CreatedToken[] | null = JSON.parse(localStorage.getItem("createdTokens") || "null");
    if (stored !== null) {
      setCreatedTokens(stored);
      const fetchBalance = async (t: CreatedToken) => {
        try {
          const accounts = await conn.getParsedTokenAccountsByOwner(
            publicKey,
            { mint: new PublicKey(t.tokenAddress), programId: TOKEN_PROGRAM_ID },
            "processed",
          );
          const amount =
            (accounts?.value[0]?.account?.data?.parsed?.info?.tokenAmount?.amount as number) /
            10 ** t.decimals;
          return amount || t.totalSupply / 10 ** t.decimals;
        } catch {
          return t.totalSupply / 10 ** t.decimals;
        }
      };
      stored.forEach(async (t) => {
        const balance = await fetchBalance(t);
        setTokenBalances((prev) => ({
          ...prev,
          [t.tokenAddress]: {
            name: t.name,
            address: t.tokenAddress,
            image: t.image,
            balance,
          },
        }));
      });
    }
    // Ничего не выбираем автоматически — токен выбирает сам пользователь из списка.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey]);

  useEffect(() => {
    if (selectedTokenValue !== null) {
      if (selectedTokenValue === false) {
        setSelectedToken(null);
        return;
      }
      setSelectedToken(createdTokens.find((t) => t.tokenAddress === selectedTokenValue) || null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTokenValue]);

  const removeLiquidity = async () => {
    // Тестовый пул: при инициации удаления просто убираем его (без обращения к Raydium).
    const target = selectedPoolForRemove as CreatedPool;
    if (target && target.txId === TEST_POOL_TX) {
      // Вместо фейковой задержки — реальная «пустая» транза: одна memo-инструкция, которая ничего
      // не меняет по балансам (только сетевой fee ~0.000005 SOL), но даёт настоящий апрув в Phantom
      // и реальный хеш. Тестпул убираем ТОЛЬКО после подтверждения транзы. (isRemoving уже true.)
      if (!publicKey) {
        showError("Please connect your wallet first");
        setIsRemoving(false);
        return;
      }
      try {
        const memoIx = new TransactionInstruction({
          keys: [],
          programId: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
          data: Buffer.from("Mintflare: remove liquidity", "utf8"),
        });
        const { blockhash } = await conn.getLatestBlockhash("finalized");
        const msg = new TransactionMessage({
          payerKey: publicKey,
          recentBlockhash: blockhash,
          instructions: [memoIx],
        }).compileToV0Message();
        const vtx = new VersionedTransaction(msg);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const phantom = (window as any)?.phantom?.solana;
        let txId: string;
        if (phantom?.isPhantom) {
          const res = await phantom.signAndSendTransaction(vtx, {
            skipPreflight: true,
            preflightCommitment: "processed",
          });
          txId = typeof res === "string" ? res : res.signature;
        } else {
          txId = await sendTransaction(vtx, conn, { skipPreflight: true, maxRetries: 5 });
        }
        await conn.confirmTransaction(txId, "confirmed");
        localStorage.removeItem("testPool");
        setPools((prev) => prev.filter((p) => p?.txId !== TEST_POOL_TX));
        setShowRemoveModal(false);
        setIsRemoving(false);
        setRemovePercent(0);
        setSelectedPoolForRemove(false);
        showSuccess("Liquidity removed successfully! Tx: " + txId);
      } catch (err) {
        setIsRemoving(false);
        const emsg = String(err);
        if (emsg.includes("User rejected"))
          showError("You rejected the transaction, try again.");
        else showError("Liquidity removal failed. Please try again.");
      }
      return true;
    }

    const raydium = await loadRaydium();
    try {
      const { poolInfo, poolKeys } = await raydium.cpmm.getPoolInfoFromRpc(
        (selectedPoolForRemove as CreatedPool).poolId,
      );
      const lpAccounts = await conn.getParsedTokenAccountsByOwner(publicKey!, {
        mint: new PublicKey(poolInfo.lpMint.address.toString()),
        programId: TOKEN_PROGRAM_ID,
      });
      const lpBalance = new BN(
        (lpAccounts?.value[0]?.account?.data?.parsed?.info?.tokenAmount?.amount as string) || "0",
      );
      const feeRecipient = resolveFeeRecipient();
      if (poolInfo && poolKeys && lpBalance) {
        const wbuilt = await raydium.cpmm.withdrawLiquidity({
          poolInfo,
          poolKeys,
          lpAmount: new BN((Number(lpBalance) * removePercent) / 100),
          slippage: new Percent(10, 100),
          txVersion: TxVersion.V0,
          computeBudgetConfig: { units: 1_000_000, microLamports: 250_000 },
          txTipConfig: {
            address: new PublicKey(feeRecipient),
            amount: new BN(0.1 * LAMPORTS_PER_SOL),
          },
        });
        // Тот же фикс, что снял плашку на создании пула: v0 + CPMM-ALT + отправка через нативный
        // Phantom signAndSendTransaction (иначе Phantom не augment'ит guard'ами → красная плашка).
        const wtx = (
          await wbuilt.builder.buildV0({ lookupTableAddress: [CPMM_LOOKUP_TABLE] })
        ).transaction;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const phantom = (window as any)?.phantom?.solana;
        let txId: string;
        if (phantom?.isPhantom) {
          const res = await phantom.signAndSendTransaction(wtx, {
            skipPreflight: true,
            preflightCommitment: "processed",
          });
          txId = typeof res === "string" ? res : res.signature;
        } else {
          txId = await sendTransaction(wtx, conn, { skipPreflight: true, maxRetries: 5 });
        }
        if (txId) {
          try {
            await walletConnection.confirmTransaction(txId, "confirmed");
            const tx = await walletConnection.getTransaction(txId, {
              commitment: "confirmed",
              maxSupportedTransactionVersion: 0,
            });
            if (tx?.meta?.err) {
              console.error("Erro ao remover liquidez:", tx.meta.err);
              showError("Liquidity removal failed. Please try again.");
            } else {
              showSuccess("Liquidity removed successfully! Tx: " + txId);
              setPools((await extractPools()).filter((p) => p != null) as (CreatedPool | undefined)[]);
            }
          } catch (e) {
            console.error("Erro ao confirmar transação:", e);
            showError("Error confirming transaction. Please try again.");
          }
        } else {
          showError("Liquidity removal failed. No transaction ID.");
        }
      }
    } catch {
      showError("Liquidity removal failed. Please try again.");
    }
    setShowRemoveModal(false);
    setIsRemoving(false);
    setRemovePercent(0);
    return true;
  };

  const createPool = async (e: React.MouseEvent | Event) => {
    e.preventDefault();
    setIsCreatingPool(true);
    setPoolCreatedResult(false);
    let loadingId: string | number | undefined;
    try {
      if (!publicKey) {
        showError("Please connect your wallet first");
        return;
      }
      // Лоадер-тост со спиннером сразу после нажатия — крутится вместе со спиннером на кнопке,
      // снимаем его на успехе/ошибке ниже.
      loadingId = showLoading("Creating pool...");
      const raydium = await loadRaydium();
      const mintA = await raydium.token.getTokenInfo(tokenAAddress!);
      const mintB = await raydium.token.getTokenInfo(tokenBAddress);
      const feeConfigs = await raydium.api.getCpmmConfigs();
      const feeRecipient = resolveFeeRecipient();

      try {
        const created = await raydium.cpmm.createPool({
          programId: CREATE_CPMM_POOL_PROGRAM,
          poolFeeAccount: CREATE_CPMM_POOL_FEE_ACC,
          mintA,
          mintB,
          mintAAmount: new BN(amountTokenA).mul(new BN(10 ** mintA.decimals)),
          mintBAmount: new BN(Number(amountTokenB) * LAMPORTS_PER_SOL),
          startTime: new BN(0),
          feeConfig: feeConfigs[0],
          associatedOnly: false,
          txVersion: TxVersion.V0,
          // Явный лимит CU (как у чистого конкурента: 1M CU + 250000 microLamports). Без него
          // дефолт 200k, и Phantom'у некуда досыпать Lighthouse-guard'ы → "This dApp could be malicious".
          computeBudgetConfig: { units: 1_000_000, microLamports: 250_000 },
          ownerInfo: { useSOLBalance: true, feePayer: publicKey },
          // Комиссию НЕ через txTipConfig (он вешает перевод ПОСЛЕДНИМ). Добавим её вручную РАНО,
          // сразу после ComputeBudget — как у чистого конкурента (Blowfish иначе флагает "пул → увод SOL").
        });
        const { extInfo } = created;

        // 1) Пересобираем v0 С публичной CPMM-ALT (сжатие → место под Lighthouse-guard'ы Phantom).
        const built = await created.builder.buildV0({
          lookupTableAddress: [CPMM_LOOKUP_TABLE],
        });
        // 2) Разбираем v0 обратно в инструкции (с ALT), вставляем перевод комиссии сразу ПОСЛЕ
        //    ведущих ComputeBudget-инструкций (как у конкурента), пересобираем v0.
        const altAcc = (await conn.getAddressLookupTable(new PublicKey(CPMM_LOOKUP_TABLE))).value;
        const altList = altAcc ? [altAcc] : [];
        const decompiled = TransactionMessage.decompile(built.transaction.message, {
          addressLookupTableAccounts: altList,
        });
        let insertAt = 0;
        while (
          insertAt < decompiled.instructions.length &&
          decompiled.instructions[insertAt].programId.toBase58() ===
            "ComputeBudget111111111111111111111111111111"
        ) {
          insertAt++;
        }
        decompiled.instructions.splice(
          insertAt,
          0,
          SystemProgram.transfer({
            fromPubkey: publicKey,
            toPubkey: new PublicKey(feeRecipient),
            lamports: Math.round(0.1 * LAMPORTS_PER_SOL),
          }),
        );
        const finalMsg = new TransactionMessage({
          payerKey: publicKey,
          recentBlockhash: built.transaction.message.recentBlockhash,
          instructions: decompiled.instructions,
        }).compileToV0Message(altList);
        const vtx = new VersionedTransaction(finalMsg);

        // 3) Отправка. Как у конкурента: НАТИВНЫЙ провайдер Phantom signAndSendTransaction —
        // Phantom сам симулирует, augment'ит Lighthouse-guard'ами, ставит blockhash, подписывает и шлёт.
        // (signTransaction+sendRawTransaction для v0 augment не давал → плашка). Внутренних подписантов
        // нет (single-signer), поэтому vtx не предподписываем — иначе Phantom не смог бы augment'ить.
        if (built.signers?.length) vtx.sign(built.signers);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const phantom = (window as any)?.phantom?.solana;
        let txId: string;
        if (phantom?.isPhantom) {
          const res = await phantom.signAndSendTransaction(vtx, {
            skipPreflight: true,
            preflightCommitment: "processed",
          });
          txId = typeof res === "string" ? res : res.signature;
        } else {
          // Остальные кошельки: универсальный signAndSend через wallet-adapter (их движок
          // безопасности тоже сможет обернуть транзу).
          txId = await sendTransaction(vtx, conn, { skipPreflight: true, maxRetries: 5 });
        }
        await conn.confirmTransaction(txId, "confirmed");
        await conn.getSignatureStatus(txId);
        const stored: CreatedPool[] = JSON.parse(localStorage.getItem("createdPools") || "[]");
        if (stored.some((p) => p.txId === txId)) return;
        const record: CreatedPool = {
          poolId: extInfo.address.poolId.toString(),
          tokenA: tokenAAddress!,
          tokenASymbol: selectedToken!.symbol,
          tokenB: tokenBAddress,
          tokenBSymbol: "SOL",
          creationDate: new Date().toISOString(),
          tokenBQty: Number(amountTokenB),
          txId,
        };
        stored.push(record);
        localStorage.setItem("createdPools", JSON.stringify(stored));
        setIsCreatingPool(false);
        dismissToast(loadingId);
        showSuccess("Pool created successfully!");
        localStorage.removeItem("pendingPoolToken");
        setPoolCreatedResult(record);
      } catch (err) {
        console.log(err);
        setIsCreatingPool(false);
        dismissToast(loadingId);
        const msg = String(err);
        if (msg.includes("User rejected the request"))
          showError("You rejected the transaction, try again.");
        else if (msg.includes("Unexpected error")) showError("Unexpected Error! Contact Support");
        else if (msg.includes("you don't has some token account"))
          showError("You're not the owner of the token you're trying to add to the pool.");
        else showError("Transaction failed. Please try again.");
      }
    } catch (err) {
      setIsCreatingPool(false);
      dismissToast(loadingId);
      showError("Something went wrong. Please try again.");
      console.error(err);
    }
  };

  const formatCompact = (n: number) => {
    if (n >= 1e12) return (n / 1e12).toFixed(2) + "T";
    if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(2) + "K";
    return n.toString();
  };

  if (!mounted) return null;

  const tokenBInfo = tokenBalances[tokenBAddress];

  return (
    <>
      {boostPool &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[100] p-4"
            onClick={() => !boosting && setBoostPool(null)}
          >
          <div
            className="bg-[var(--surface)] border-2 border-yellow-400 rounded-2xl w-full max-w-md p-6 relative shadow-[0_0_40px_rgba(250,204,21,0.35)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-white">Boost Your Token</h2>
              <button
                onClick={() => !boosting && setBoostPool(null)}
                className="text-neutral-400 hover:text-white text-xl leading-none"
              >
                ✕
              </button>
            </div>

            {/* Скрин топа Dexscreener trending */}
            <img
              src="/444444.png"
              alt="Dexscreener trending"
              className="w-full rounded-xl border border-[var(--border)] mb-5"
            />

            <p className="text-sm text-neutral-300 mb-5">
              Boost your token to the top of{" "}
              <span className="font-semibold text-white">Dexscreener&apos;s trending list</span> for{" "}
              <span className="font-semibold text-white">1 hour</span>, maximizing visibility to
              thousands of traders actively scanning for new opportunities.
            </p>

            <div className="flex items-center justify-between bg-black/40 border border-[var(--border)] rounded-lg p-4 mb-5">
              <div>
                <p className="text-xs text-neutral-500">Boost duration</p>
                <p className="text-white font-semibold">1 Hour</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-neutral-500">Cost</p>
                <p className="text-yellow-400 font-bold">0.35 SOL</p>
              </div>
            </div>

            <button
              onClick={handleBoost}
              disabled={boosting}
              className="w-full py-3 rounded-lg bg-gradient-to-b from-yellow-400 to-amber-500 hover:from-yellow-500 hover:to-amber-600 disabled:opacity-60 disabled:cursor-not-allowed text-black font-bold text-lg transition-all shadow-[0_0_24px_rgba(250,204,21,0.55)] hover:shadow-[0_0_32px_rgba(250,204,21,0.75)]"
            >
              {boosting ? "Boosting..." : "Boost"}
            </button>

            <p className="text-center text-xs text-neutral-500 mt-3">
              You must have 0.35 SOL for the platform fee plus network costs.
            </p>
          </div>
          </div>,
          document.body,
        )}

      {showRemoveModal && selectedPoolForRemove &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100]">
            <div className="bg-[var(--surface)] p-6 rounded-lg w-96">
            <h2 className="text-xl font-bold text-white mb-4">Remove Liquidity</h2>
            <p className="text-neutral-400 mb-2">
              LP Token Balance:{" "}
              {(Number((selectedPoolForRemove as CreatedPool).poolData!.lpAmount.toString()) / 1e9).toFixed(2)}
            </p>
            <div className="flex gap-2 mb-4">
              {[25, 50, 75, 100].map((p) => (
                <button
                  key={p}
                  className="flex-1 p-2 rounded text-sm font-medium transition-colors bg-[var(--surface-2)] text-neutral-300 hover:bg-[var(--surface)]"
                  onClick={() => setRemovePercent(p)}
                >
                  {p}%
                </button>
              ))}
            </div>
            <input
              min={0}
              max={100}
              className="w-full mb-4"
              type="range"
              value={removePercent}
              onChange={(e) => setRemovePercent(parseInt(e.target.value))}
            />
            <p className="text-white mb-4">Remove {removePercent}% of LP tokens</p>
            <button
              disabled={isRemoving || removePercent <= 0}
              className="w-full p-2 bg-red-500 text-white rounded hover:bg-red-600 disabled:bg-red-300"
              onClick={() => {
                if (removePercent <= 0) return;
                setIsRemoving(true);
                removeLiquidity();
              }}
            >
              {isRemoving ? "Removing..." : "Remove Liquidity"}
            </button>
            <button
              className="w-full p-2 mt-2 bg-[var(--surface-2)] text-white rounded hover:bg-[var(--surface)]"
              onClick={() => {
                setShowRemoveModal(false);
                setRemovePercent(0);
                setSelectedPoolForRemove(false);
              }}
            >
              Cancel
            </button>
            <div className="text-center pt-4 italic text-neutral-400 text-sm">
              You must have 0.1 SOL to Remove Liquidity.
            </div>
          </div>
          </div>,
          document.body,
        )}

      <div className="text-gray-200 p-2 pt-8 mb-12">
        <div className="w-full max-w-5xl mx-auto px-0 sm:px-6 lg:px-8">
          <main className="flex-1 flex flex-col items-center justify-center px-4 sm:px-0 pt-8 sm:pt-16">
            <div className="flex flex-col items-center w-full sm:w-[800px]">
              <h2 className="text-2xl sm:text-3xl font-bold mb-8 text-white">
                Create Raydium Liquidity Pool
              </h2>
              <div className="bg-[var(--surface)] p-6 rounded-lg mb-16 w-full sm:w-[800px]">
                <div className="space-y-6">
                  <div>
                    <label className="block text-base font-medium text-gray-300 mb-4 sm:mb-4 mb-10">
                      For which token would you like to create a pool?
                    </label>
                    <div className="relative">
                      <select
                        className="w-full p-2 pr-10 bg-[var(--surface-2)] text-white rounded appearance-none cursor-pointer"
                        value={selectedTokenValue ? String(selectedTokenValue) : ""}
                        onChange={(e) => {
                          const value = e.target.value || false;
                          setTokenAAddress(value || null);
                          setSelectedTokenValue(value);
                        }}
                      >
                        <option value="" disabled>
                          Choose your token
                        </option>
                        {createdTokens.map((t) => (
                          <option key={t.tokenAddress} value={t.tokenAddress}>
                            {t.symbol} - Balance: {tokenBalances[t.tokenAddress]?.balance || 0}{" "}
                            {t.symbol}
                          </option>
                        ))}
                      </select>
                      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-300">
                        <svg className="fill-current h-4 w-4" viewBox="0 0 20 20">
                          <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
                        </svg>
                      </div>
                    </div>
                  </div>

                  {selectedToken && !poolCreatedResult && (
                    <>
                      <div className="mt-2 flex items-center space-x-2">
                        <img
                          key={selectedToken.tokenAddress}
                          alt="Token"
                          className="w-6 h-6 rounded-full bg-[var(--surface-2)]"
                          src={selectedToken.image || "/rocket.png"}
                        />
                        <input
                          readOnly
                          className="flex-1 p-2 bg-neutral-600 text-white rounded text-sm font-mono"
                          type="text"
                          value={selectedToken.tokenAddress}
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">Token B</label>
                        <div className="relative flex items-center space-x-2">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            alt={tokenBInfo?.name}
                            loading="lazy"
                            width={24}
                            height={24}
                            src={tokenBInfo?.image}
                            style={{ color: "transparent" }}
                          />
                          <select
                            className="flex-1 p-2 pr-10 bg-[var(--surface-2)] text-white rounded appearance-none cursor-pointer"
                            defaultValue={tokenBAddress}
                            onChange={(e) => setTokenBAddress(e.target.value)}
                          >
                            <option value={SOL_MINT}>
                              SOL - Balance: {Number(solBalance).toFixed(3)} SOL
                            </option>
                          </select>
                          <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-gray-300">
                            <svg className="fill-current h-4 w-4" viewBox="0 0 20 20">
                              <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
                            </svg>
                          </div>
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">
                          Amount Token A
                        </label>
                        <div className="flex space-x-2">
                          <div className="flex-1 relative">
                            <input
                              className="w-full p-2 bg-[var(--surface-2)] text-white rounded"
                              placeholder="0"
                              type="number"
                              value={amountTokenA}
                              max={selectedToken.totalSupply / 10 ** selectedToken.decimals}
                              onChange={(e) => {
                                const v = e.target.value;
                                if (!isNaN(Number(v)) && Number(v) >= 0) setAmountTokenA(v);
                              }}
                            />
                            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex space-x-1">
                              <button
                                className="px-2 py-1 text-xs bg-neutral-600 text-white rounded hover:bg-neutral-500 transition-colors"
                                onClick={() => {
                                  const half =
                                    selectedToken.totalSupply / 10 ** selectedToken.decimals / 2;
                                  setAmountTokenA(String(half < 0 ? 0 : half));
                                }}
                              >
                                Half
                              </button>
                              <button
                                className="px-2 py-1 text-xs bg-neutral-600 text-white rounded hover:bg-neutral-500 transition-colors"
                                onClick={() => {
                                  const ninety =
                                    (selectedToken.totalSupply / 10 ** selectedToken.decimals) * 0.9;
                                  setAmountTokenA(String(ninety < 0 ? 0 : ninety));
                                }}
                              >
                                90%
                              </button>
                              <button
                                className="px-2 py-1 text-xs bg-neutral-600 text-white rounded hover:bg-neutral-500 transition-colors"
                                onClick={() =>
                                  setAmountTokenA(
                                    String(selectedToken.totalSupply / 10 ** selectedToken.decimals),
                                  )
                                }
                              >
                                Max
                              </button>
                            </div>
                          </div>
                        </div>
                        <div className="mt-1 text-xs text-neutral-400">
                          Balance:{" "}
                          {(selectedToken.totalSupply / 10 ** selectedToken.decimals)
                            .toString()
                            .replace(/\B(?=(\d{3})+(?!\d))/g, ".")}{" "}
                          ${selectedToken.symbol}
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">
                          Amount Token B (0.3 SOL reserved for liquidity fees)
                        </label>
                        <div className="flex space-x-2">
                          <div className="flex-1 relative">
                            <input
                              className="w-full p-2 bg-[var(--surface-2)] text-white rounded"
                              placeholder="0"
                              type="text"
                              value={amountTokenB}
                              onChange={(e) => setAmountTokenB(e.target.value)}
                            />
                            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex space-x-1">
                              <button
                                className="px-2 py-1 text-xs bg-neutral-600 text-white rounded hover:bg-neutral-500 transition-colors"
                                onClick={() => {
                                  const avail = tokenBAddress.includes("So1")
                                    ? Number((parseFloat(String(solBalance)) - 0.31).toFixed(2)) < 0
                                      ? 0
                                      : Number((parseFloat(String(solBalance)) - 0.31).toFixed(2))
                                    : usdcBalance;
                                  setAmountTokenB(String(avail / 2));
                                }}
                              >
                                Half
                              </button>
                              <button
                                className="px-2 py-1 text-xs bg-neutral-600 text-white rounded hover:bg-neutral-500 transition-colors"
                                onClick={() => {
                                  const avail = tokenBAddress.includes("So1")
                                    ? Number((parseFloat(String(solBalance)) - 0.31).toFixed(2)) < 0
                                      ? 0
                                      : Number((parseFloat(String(solBalance)) - 0.31).toFixed(2))
                                    : usdcBalance;
                                  setAmountTokenB(String(avail));
                                }}
                              >
                                Max
                              </button>
                            </div>
                          </div>
                        </div>
                        <div className="mt-1 text-xs text-neutral-400">
                          Balance:{" "}
                          {tokenBAddress.includes("So1") ? Number(solBalance).toFixed(3) : usdcBalance}{" "}
                          {tokenBAddress.includes("So1") ? "SOL" : "USDC"}
                        </div>
                      </div>

                      <button
                        disabled={
                          isCreatingPool ||
                          !(
                            Number(amountTokenA) > 0 &&
                            Number(amountTokenB) > 0 &&
                            parseFloat(amountTokenB) + 0.31 <= solBalance &&
                            solBalance >= Number(amountTokenB)
                          )
                        }
                        className="w-full p-2 bg-[var(--accent)] text-white rounded hover:bg-[var(--accent-hover)] disabled:bg-teal-700 flex items-center justify-center font-bold text-lg"
                        onClick={(e) => createPool(e)}
                      >
                        {isCreatingPool ? "Creating Pool..." : "Create Pool"}
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
                          className="lucide lucide-check ml-2 h-4 w-4"
                        >
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                      </button>
                    </>
                  )}

                  {poolCreatedResult && (
                    <div className="text-white font-bold mt-8 bg-[var(--surface)] rounded-lg">
                      <p>
                        Pool created successfully!{" "}
                        <a
                          href={`https://solscan.io/tx/${(poolCreatedResult as CreatedPool).txId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-green-500"
                        >
                          View your transaction here
                        </a>
                      </p>
                      <br />
                      <p>Update your Raydium Pools list by clicking the refresh button below.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {(publicKey || pools.length > 0) && (
              <div className="space-y-4 w-full max-w-[800px] mx-auto">
                <div className="flex justify-between items-center">
                  <h2 className="text-xl sm:text-2xl font-bold text-white">Your Raydium Pools</h2>
                  <button
                    disabled={refreshing}
                    className={`flex items-center rounded-lg transition-colors px-3 py-2 ${
                      refreshing
                        ? "bg-[var(--accent-hover)] opacity-60 cursor-not-allowed"
                        : "bg-[var(--accent)] hover:bg-[var(--accent-hover)]"
                    }`}
                    onClick={async () => {
                      if (refreshing) return;
                      setRefreshing(true);
                      // Загрузка минимум 0.7с (видна анимация), данные применяются после.
                      const [real] = await Promise.all([
                        extractPools().then(
                          (r) => r.filter((p) => p !== null) as (CreatedPool | undefined)[],
                        ),
                        new Promise((res) => setTimeout(res, 700)),
                      ]);
                      setPools(withTestPool(real));
                      setRefreshing(false);
                    }}
                  >
                    <svg
                      className={`w-5 h-5 text-white mr-2 ${refreshing ? "animate-spin" : ""}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                      />
                    </svg>
                    <span className="text-white text-sm">Refresh</span>
                  </button>
                </div>

                {pools.length > 0 ? (
                  pools.map((pool, idx) => {
                    if (pool === undefined) return null;
                    const pooledSol = (
                      parseFloat(pool?.poolData?.pooledTokenA || "0") -
                      parseFloat(String(pool?.tokenBQty))
                    ).toFixed(2);
                    const pnlUsd = solPrice * Number(pooledSol);
                    const pnlPct = (Number(pooledSol) / parseFloat(String(pool?.tokenBQty))) * 100;
                    return (
                      <div
                        key={idx}
                        className="hover-lift bg-[var(--surface)] p-4 sm:p-6 rounded-2xl border border-[var(--border)] hover:border-[var(--accent)]/40 space-y-4 sm:space-y-6 w-full sm:w-[800px] relative"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-4 sm:space-y-0">
                          <div className="flex items-center space-x-3">
                            <div className="flex items-center -space-x-1">
                              <img
                                alt="Token A"
                                className="w-6 h-6 sm:w-8 sm:h-8 object-contain"
                                src="/solana-sol-logo.png"
                              />
                              <TokenImage
                                alt="Token B"
                                className="w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-[var(--surface-2)] border border-neutral-600 object-cover"
                                src={pool?.image}
                                mint={pool?.tokenA}
                              />
                            </div>
                            <div>
                              <h2 className="text-xl sm:text-2xl font-bold text-white">
                                {pool?.tokenBSymbol}-{pool?.tokenASymbol}
                              </h2>
                              <p className="text-neutral-400 text-xs sm:text-sm">
                                {shorten(pool?.tokenB || "")}-{shorten(pool?.tokenA || "")}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center space-x-2">
                            <button
                              onClick={() => setBoostPool(pool)}
                              className="flex-1 sm:flex-none flex items-center justify-center space-x-2 bg-yellow-400 hover:bg-yellow-500 rounded-lg text-black transition-all px-3 py-2 text-sm font-semibold hover:shadow-[0_0_18px_rgba(250,204,21,0.7)]"
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 24 24"
                                fill="currentColor"
                                className="w-4 h-4 sm:w-5 sm:h-5"
                              >
                                <path d="M13 2 3 14h7l-1 8 10-12h-7z" />
                              </svg>
                              <span>Boost</span>
                            </button>
                            <a
                              href={`https://gmgn.ai/sol/token/${pool?.tokenA}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex-1 sm:flex-none flex items-center justify-center space-x-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg text-white transition-colors px-3 py-2 text-sm font-semibold"
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
                                className="w-4 h-4 sm:w-5 sm:h-5"
                              >
                                <path d="M3 3v18h18" />
                                <path d="m19 9-5 5-4-4-3 3" />
                              </svg>
                              <span>View on GMGN</span>
                            </a>
                            <button
                              className="p-2 bg-red-500 hover:bg-red-600 rounded-lg text-white"
                              onClick={() => {
                                setSelectedPoolForRemove(pool);
                                setShowRemoveModal(true);
                              }}
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width={20}
                                height={20}
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth={2}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="w-4 h-4 sm:w-5 sm:h-5"
                              >
                                <line x1={5} y1={12} x2={19} y2={12} />
                              </svg>
                            </button>
                          </div>
                        </div>

                        <div className="text-xs text-neutral-400" id="token-note-container" />
                        <div className="mb-2 text-xs sm:text-sm text-neutral-400 break-all">
                          Pool ID: <span className="text-white">{pool?.poolId}</span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                          <div className="bg-[var(--background)] p-4 rounded-lg">
                            <h3 className="text-neutral-400 text-sm mb-2">Pooled SOL</h3>
                            <div className="flex items-center space-x-2">
                              <img
                                alt="Token A"
                                className="w-6 h-6 object-contain"
                                src="/solana-sol-logo.png"
                              />
                              <span className="text-white text-lg font-medium">
                                {pool?.poolData?.pooledTokenA}
                              </span>
                            </div>
                          </div>
                          <div className="bg-[var(--background)] p-4 rounded-lg">
                            <h3 className="text-neutral-400 text-sm mb-2">Pooled {pool?.tokenASymbol}</h3>
                            <div className="flex items-center space-x-2">
                              <TokenImage
                                alt="Token B"
                                className="w-6 h-6 rounded-full object-cover"
                                src={pool?.image}
                                mint={pool?.tokenA}
                              />
                              <span className="text-white text-lg font-medium">
                                {formatCompact(pool?.poolData?.pooledTokenBRaw || 0)}
                              </span>
                            </div>
                          </div>
                          <div className="bg-[var(--background)] p-4 rounded-lg">
                            <h3 className="text-neutral-400 text-sm mb-2">Profit/Loss</h3>
                            <div className="flex items-center space-x-2">
                              <div className="flex flex-col">
                                <span className="text-green-500 text-md font-semibold">
                                  {pnlUsd >= 0 ? "+" : "-"}
                                  {pnlUsd.toFixed(2)} USD (${pnlPct.toFixed(2)}%)
                                </span>
                                <span className="text-gray-400 text-sm">
                                  ≈ {Number(pooledSol) >= 0 ? "+" : "-"}
                                  {pooledSol} SOL
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-white">No pools found with LP tokens.</div>
                )}
              </div>
            )}

            {!publicKey && pools.length === 0 && (
              <div className="text-white text-center text-2xl font-bold mt-8 bg-[var(--surface)] p-8 px-12 rounded-lg">
                Please connect your wallet to create a pool.
              </div>
            )}
          </main>
        </div>
      </div>
    </>
  );
}
