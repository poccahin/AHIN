import assert from "node:assert/strict";
import { detectWalletProvider } from "../src/gate/wallet/wallet-detection";
import { isMockFallbackComplete, runMockFallbackTimeline, type MockFallbackState } from "../src/gate/wallet/mock-fallback";
import { mapWalletProviderError } from "../src/gate/wallet/wallet-errors";
import { formatWalletConnectionError } from "../src/lib/walletAdapters";
import { isLiveLifePlusTransferEnabled } from "../src/lib/lifePlusSolana";

const runtime = globalThis as unknown as { window?: unknown };
const originalWindow = runtime.window;
const originalGateMode = process.env.NEXT_PUBLIC_AHIN_GATE_MODE;
const originalBurn = process.env.NEXT_PUBLIC_ENABLE_MAINNET_BURN;

try {
  delete runtime.window;
  assert.equal(detectWalletProvider("phantom").status, "browser_unsupported");

  runtime.window = {};
  assert.equal(detectWalletProvider("okx").status, "not_detected");

  assert.equal(mapWalletProviderError({ code: -32002 }).code, "WALLET_REQUEST_PENDING");
  assert.equal(mapWalletProviderError({ code: 4001 }).code, "WALLET_USER_REJECTED");
  assert.equal(mapWalletProviderError(undefined).code, "WALLET_UNKNOWN_PROVIDER_ERROR");
  const forbidden = formatWalletConnectionError("Phantom", new Error("403 Access forbidden: raw RPC response"));
  assert.equal(forbidden.includes("403"), false);
  assert.equal(forbidden.includes("Access forbidden"), false);
  assert.match(forbidden, /continue in readonly evidence mode/);

  let providerCalled = false;
  runtime.window = {
    phantom: {
      solana: {
        isPhantom: true,
        connect: () => {
          providerCalled = true;
          throw new Error("provider should not be called");
        }
      }
    }
  };
  const states: MockFallbackState[] = [];
  const finalState = runMockFallbackTimeline((state) => states.push(state));
  assert.equal(finalState, "matrix_active");
  assert.equal(isMockFallbackComplete(states), true);
  assert.equal(providerCalled, false);

  process.env.NEXT_PUBLIC_AHIN_GATE_MODE = "mock";
  process.env.NEXT_PUBLIC_ENABLE_MAINNET_BURN = "false";
  assert.equal(isLiveLifePlusTransferEnabled(), false);

  console.log("Wallet UX hardening fixtures passed");
} finally {
  runtime.window = originalWindow;
  if (originalGateMode === undefined) {
    delete process.env.NEXT_PUBLIC_AHIN_GATE_MODE;
  } else {
    process.env.NEXT_PUBLIC_AHIN_GATE_MODE = originalGateMode;
  }
  if (originalBurn === undefined) {
    delete process.env.NEXT_PUBLIC_ENABLE_MAINNET_BURN;
  } else {
    process.env.NEXT_PUBLIC_ENABLE_MAINNET_BURN = originalBurn;
  }
}
