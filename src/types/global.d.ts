export {};

declare global {
  interface Window {
    Buffer?: typeof import("buffer").Buffer;
    global?: typeof globalThis;
    plausible?: (
      event: string,
      options?: { props?: Record<string, unknown>; callback?: () => void },
    ) => void;
    // Dev-хелпер: добавить визуальный тестовый пул на /create-liquidity-pool.
    addTestPool?: (
      tokenAddress?: string,
      initialSol?: number,
      targetUsd?: number,
      seconds?: number,
    ) => Promise<void>;
  }
}
