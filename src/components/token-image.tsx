"use client";

import { useEffect, useMemo, useState } from "react";
import { ipfsCandidates, TOKEN_PLACEHOLDER } from "@/lib/token-image";

// <img> токена с перебором источников по onError: рабочие ipfs-гейтвеи → (если задан mint)
// иконка Raydium → тёмный плейсхолдер. Браузер грузит напрямую, без /api/img воркера.
export function TokenImage({
  src,
  mint,
  alt = "",
  className,
}: {
  src?: string;
  mint?: string;
  alt?: string;
  className?: string;
}) {
  const candidates = useMemo(() => {
    const list = ipfsCandidates(src);
    if (mint) list.push(`https://img-v1.raydium.io/icon/${mint}.png`);
    list.push(TOKEN_PLACEHOLDER);
    return list;
  }, [src, mint]);

  const [idx, setIdx] = useState(0);
  // Источник сменился (рефреш списка пулов) — начинаем перебор заново.
  useEffect(() => setIdx(0), [src, mint]);

  return (
    <img
      alt={alt}
      className={className}
      src={candidates[Math.min(idx, candidates.length - 1)]}
      onError={() => setIdx((i) => (i < candidates.length - 1 ? i + 1 : i))}
    />
  );
}
