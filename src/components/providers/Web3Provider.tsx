"use client";

import type { ReactNode } from "react";

interface AhinWeb3ProviderProps {
  children: ReactNode;
}

export function Web3Provider({ children }: AhinWeb3ProviderProps) {
  // Readonly evidence mode only. No wallet provider context is mounted.
  return <>{children}</>;
}

export default Web3Provider;
