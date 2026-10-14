// База API-бэкенда. Фронт теперь статика (Cloudflare Pages), а 4 ручки живут
// на отдельном Node-сервисе. В проде задаём NEXT_PUBLIC_API_BASE=https://api.mintflare.fun
// (впекается на этапе build). Пусто → относительные пути (для локальной разработки,
// если поднять бэк на том же origin).
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

export const apiUrl = (path: string) => `${API_BASE}${path}`;
