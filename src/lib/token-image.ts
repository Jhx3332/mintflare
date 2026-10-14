// Разрешение картинок токенов на РАБОЧИХ IPFS-гейтвеях — клиентски, без воркер-прокси.
// Проверено (02.10.2026): filebase / 4everland / pinata → 200 + Access-Control-Allow-Origin:*,
// а ipfs.io / dweb.link / nftstorage / cdn.helius-rpc (cdn_uri) мертвы (403/429/302).
// Рабочие гейтвеи не шлют Cross-Origin-Resource-Policy: same-origin, поэтому браузер грузит
// <img> с них НАПРЯМУЮ (как у конкурента) — наш Worker в цепочке больше не нужен.
export const IPFS_GATEWAYS = [
  "https://ipfs.filebase.io/ipfs/",
  "https://4everland.io/ipfs/",
  "https://gateway.pinata.cloud/ipfs/",
];

// Нейтральный тёмный кружок — финальный фолбэк, если картинки нет ни на одном гейтвее.
export const TOKEN_PLACEHOLDER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Ccircle cx='12' cy='12' r='12' fill='%231c2b30'/%3E%3C/svg%3E";

// Любую ipfs-ссылку превращает в список кандидатов на рабочих гейтвеях.
// Понимает: ipfs://CID, ipfs://ipfs/CID, https://<любой-гейтвей>/ipfs/CID/path.png.
// CID с путём (/ipfs/<CID>/img.png) сохраняется целиком. Не-ipfs (arweave, обычный https,
// data:) и локальные пути (/...) возвращает как есть.
export function ipfsCandidates(u?: string): string[] {
  const s = String(u || "");
  if (!s) return [];
  if (s.startsWith("/") || s.startsWith("data:")) return [s];
  const m = s.match(/^ipfs:\/\/(?:ipfs\/)?(.+)$/) || s.match(/\/ipfs\/([^?#]+)/);
  return m ? IPFS_GATEWAYS.map((g) => g + m[1]) : [s];
}
