"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WagmiProvider, createConfig, http } from "wagmi";
import { mainnet } from "wagmi/chains";
import { injected, metaMask } from "wagmi/connectors";

const evmRpcUrl = process.env.NEXT_PUBLIC_EVM_RPC_URL;
const solanaEndpoint = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? process.env.VITE_SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";

const wagmiConfig = createConfig({
  chains: [mainnet],
  connectors: [metaMask(), injected({ shimDisconnect: true })],
  transports: {
    [mainnet.id]: http(evmRpcUrl)
  },
  ssr: true
});

interface AhinWeb3ProviderProps {
  children: ReactNode;
}

export default function AhinWeb3Provider({ children }: AhinWeb3ProviderProps) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ConnectionProvider endpoint={solanaEndpoint}>
          <WalletProvider wallets={[]} autoConnect={false}>
            {children}
          </WalletProvider>
        </ConnectionProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
