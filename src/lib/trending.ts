// Агрегатор трендовых токенов на публичном API Dexscreener — КЛИЕНТСКИЙ.
// Запросы идут из браузера пользователя напрямую в api.dexscreener.com (CORS открыт:
// access-control-allow-origin: *), поэтому рейтлимит считается на IP КАЖДОГО посетителя,
// а не на общие egress-IP Cloudflare Worker. Так делает конкурент — отсюда его неубиваемость.
// Кэш-бастер НЕ добавляем: Dexscreener отдаёт Cache-Control max-age=60, повторные запросы
// в пределах минуты берутся из браузерного кэша (спам Refresh = попадания в кэш, 0 нагрузки).

const DS = "https://api.dexscreener.com";

const SOURCE_ORDER: Record<string, string[]> = {
  trending: [
    "/token-boosts/top/v1",
    "/token-boosts/latest/v1",
    "/token-profiles/latest/v1",
    "/community-takeovers/latest/v1",
  ],
  new: [
    "/token-profiles/latest/v1",
    "/community-takeovers/latest/v1",
    "/token-boosts/latest/v1",
    "/token-boosts/top/v1",
  ],
};
const POOL_MAX = 90;
const TOP_SLICE = 45;
const RETURN_COUNT = 21;

export interface TrendingToken {
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

async function dsFetch(path: string): Promise<unknown> {
  const res = await fetch(`${DS}${path}`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`dexscreener ${path} → ${res.status}`);
  return res.json();
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

interface DsListItem {
  chainId?: string;
  tokenAddress?: string;
}

async function collectAddresses(paths: string[], max: number): Promise<string[]> {
  const results = await Promise.allSettled(paths.map((p) => dsFetch(p)));
  const addrs: string[] = [];
  for (const r of results) {
    if (r.status !== "fulfilled" || !Array.isArray(r.value)) continue;
    for (const item of r.value as DsListItem[]) {
      if (item?.chainId === "solana" && item.tokenAddress && !addrs.includes(item.tokenAddress)) {
        addrs.push(item.tokenAddress);
        if (addrs.length >= max) return addrs;
      }
    }
  }
  return addrs;
}

interface DsSocial {
  type?: string;
  url?: string;
}
interface DsPair {
  baseToken?: { address?: string; name?: string; symbol?: string };
  info?: { imageUrl?: string; socials?: DsSocial[] };
  liquidity?: { usd?: number };
  marketCap?: number;
  fdv?: number;
  volume?: { h24?: number };
  priceChange?: { h24?: number };
  pairCreatedAt?: number;
}

// Тянет и агрегирует трендовые токены для категории. Бросает, если Dexscreener недоступен
// (вызывающий код решает, что делать — например, откатиться на /api/trending воркера).
export async function fetchTrending(category: "trending" | "new"): Promise<TrendingToken[]> {
  const paths = SOURCE_ORDER[category] || SOURCE_ORDER.trending;
  const addresses = await collectAddresses(paths, POOL_MAX);
  if (!addresses.length) return [];

  const batches = await Promise.allSettled(
    chunk(addresses, 30).map((cc) => dsFetch(`/tokens/v1/solana/${cc.join(",")}`)),
  );
  const pairs: DsPair[] = batches.flatMap((r) =>
    r.status === "fulfilled" && Array.isArray(r.value) ? (r.value as DsPair[]) : [],
  );

  // На адрес берём пару с наибольшей ликвидностью.
  const best = new Map<string, DsPair>();
  for (const p of pairs) {
    const addr = p.baseToken?.address;
    if (!addr) continue;
    const cur = best.get(addr);
    if (!cur || (p.liquidity?.usd || 0) > (cur.liquidity?.usd || 0)) best.set(addr, p);
  }

  let tokens: TrendingToken[] = [];
  for (const p of best.values()) {
    if (!p.baseToken) continue;
    const socials = p.info?.socials || [];
    tokens.push({
      mint: p.baseToken.address || "",
      name: p.baseToken.name || "",
      symbol: p.baseToken.symbol || "",
      image_uri: p.info?.imageUrl || "",
      usd_market_cap: p.marketCap ?? p.fdv ?? 0,
      volume_24h: p.volume?.h24 ?? 0,
      price_change_24h: p.priceChange?.h24 ?? 0,
      created_at: p.pairCreatedAt ?? 0,
      twitter: socials.find((s) => s.type === "twitter")?.url,
      telegram: socials.find((s) => s.type === "telegram")?.url,
    });
  }

  tokens =
    category === "new"
      ? tokens.sort((a, b) => b.created_at - a.created_at)
      : tokens.sort((a, b) => b.volume_24h - a.volume_24h);
  return shuffle(tokens.slice(0, TOP_SLICE)).slice(0, RETURN_COUNT);
}
