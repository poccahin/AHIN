import type { Metadata } from "next";
import AhinWeb3Provider from "@/src/components/providers/Web3Provider";
import "./globals.css";
import "@/src/gate/ahin-gate.css";
import "@/src/gate/matrix/matrix.css";
import "@/src/components/governance/governance-console.css";

export const metadata: Metadata = {
  title: "ahin.io Gate",
  description: "Multi-Agent Zero-Trust Network gate interface"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AhinWeb3Provider>{children}</AhinWeb3Provider>
      </body>
    </html>
  );
}
