"use client";

import { Buffer } from "buffer";
import { createContext, useCallback, useContext, useMemo, useState } from "react";

// Полифилл Buffer для браузера (нужен @solana/web3.js, Metaplex, Raydium).
if (typeof window !== "undefined") {
  window.Buffer = window.Buffer || Buffer;
  window.global = window.global || window;
}
import { WalletAdapterNetwork, WalletError } from "@solana/wallet-adapter-base";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";

import "@solana/wallet-adapter-react-ui/styles.css";

const RPC_ENDPOINT =
  process.env.NEXT_PUBLIC_RPC_ENDPOINT ||
  "https://mainnet.helius-rpc.com/?api-key=YOUR_HELIUS_API_KEY";

type AutoConnectContextState = {
  autoConnect: boolean;
  setAutoConnect: (value: boolean) => void;
};

const AutoConnectContext = createContext<AutoConnectContextState>(
  {} as AutoConnectContextState,
);

export function useAutoConnect() {
  return useContext(AutoConnectContext);
}

function AutoConnectProvider({ children }: { children: React.ReactNode }) {
  const [autoConnect, setAutoConnect] = useState(true);
  return (
    <AutoConnectContext.Provider value={{ autoConnect, setAutoConnect }}>
      {children}
    </AutoConnectContext.Provider>
  );
}

function WalletContextProvider({ children }: { children: React.ReactNode }) {
  const { autoConnect } = useAutoConnect();

  // Kept for parity with the original build (network was WalletAdapterNetwork.Mainnet).
  const network = WalletAdapterNetwork.Mainnet;
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [network],
  );

  const onError = useCallback((error: WalletError) => {
    console.error(error);
  }, []);

  return (
    <ConnectionProvider endpoint={RPC_ENDPOINT}>
      <WalletProvider wallets={wallets} onError={onError} autoConnect={autoConnect}>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

export function ContextProvider({ children }: { children: React.ReactNode }) {
  return (
    <AutoConnectProvider>
      <WalletContextProvider>{children}</WalletContextProvider>
    </AutoConnectProvider>
  );
}
