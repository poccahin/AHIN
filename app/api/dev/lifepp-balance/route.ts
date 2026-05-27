/**
 * Dev-only Solana balance smoke endpoint — Phase 1 devnet rehearsal.
 *
 * GET /api/dev/lifepp-balance?wallet=<base58>
 *
 * Exercises src/lib/lifePlusSolana.ts#readLifePlusBalanceRaw against the
 * configured RPC (NEXT_PUBLIC_SOLANA_RPC_URL, default devnet) and reports
 * back the raw bigint balance plus a UI-decimal-shifted preview.
 *
 * Purpose: confirm end-to-end that
 *   - the new @solana/web3.js Connection actually reaches the chain,
 *   - the spl-token ATA derivation is correct,
 *   - the AccountNotFound -> 0n exception guard catches the case where
 *     the wallet's LIFE++ ATA does not exist on-chain (brand-new wallets).
 *
 * REMOVE BEFORE MAINNET. This route exposes an authenticated-by-nothing
 * read of any wallet's balance. On devnet that's harmless (RPC is public
 * anyway), but it shouldn't ride along to a mainnet/production deploy.
 */

import { isLikelySolanaAddress } from "@/src/lib/addressValidation";
import { readLifePlusBalanceRaw } from "@/src/lib/lifePlusSolana";
import type { WalletConnection } from "@/src/lib/walletAdapters";

const DEFAULT_RPC_URL = "https://api.devnet.solana.com";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const wallet = url.searchParams.get("wallet");
  const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() || DEFAULT_RPC_URL;

  if (!wallet) {
    return Response.json(
      {
        ok: false,
        error: "missing_wallet_param",
        diagnostic: "Pass ?wallet=<base58 Solana address>"
      },
      { status: 400 }
    );
  }

  if (!isLikelySolanaAddress(wallet)) {
    return Response.json(
      {
        ok: false,
        wallet,
        rpcUrl,
        error: "invalid_wallet_address",
        diagnostic: "Address failed isLikelySolanaAddress() shape check."
      },
      { status: 400 }
    );
  }

  // Minimal WalletConnection stub: readLifePlusBalanceRaw only consumes
  // `.address`. The remaining fields are required by the type but unused
  // along this code path.
  const stub: WalletConnection = {
    id: "phantom_solana",
    label: "Dev Smoke",
    rail: "solana",
    address: wallet,
    chainId: null,
    readonlyEvidenceMode: true,
    walletProviderDetected: true
  };

  try {
    const balance = await readLifePlusBalanceRaw(stub, wallet);
    // Number(bigint) loses precision above 2^53; for Phase 1 devnet test
    // balances this is fine. If we ever query mainnet treasury-scale
    // amounts, swap to a precise decimal-shift via string manipulation.
    const parsedUiAmount = Number(balance) / 1e9;

    return Response.json({
      ok: true,
      wallet,
      rpcUrl,
      rawBalance: balance.toString(),
      parsedUiAmount,
      diagnostic:
        balance === 0n
          ? "Returned 0n. Either the ATA does not exist on-chain (AccountNotFound guard fired) or the ATA exists with zero balance. Either path validates that the guard prevented an unhandled throw."
          : "Returned a positive balance. ATA exists on-chain with non-zero LIFE++ holdings."
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      {
        ok: false,
        wallet,
        rpcUrl,
        error: "balance_read_failed",
        diagnostic: message,
        hint:
          "If the message looks like 'could not find account' or similar, the heuristic in isAccountNotFoundError() failed to match this RPC's wording. Update the match list in src/lib/lifePlusSolana.ts."
      },
      { status: 502 }
    );
  }
}
