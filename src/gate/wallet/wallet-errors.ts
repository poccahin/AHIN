export type WalletErrorCode =
  | "WALLET_NOT_DETECTED"
  | "WALLET_REQUEST_PENDING"
  | "WALLET_PROVIDER_CONFLICT"
  | "WALLET_USER_REJECTED"
  | "WALLET_BROWSER_UNSUPPORTED"
  | "WALLET_UNKNOWN_PROVIDER_ERROR";

export interface RecoverableWalletError {
  code: WalletErrorCode;
  severity: "warning";
  message: string;
}

const COPY: Record<WalletErrorCode, string> = {
  WALLET_NOT_DETECTED: "Wallet extension not detected in this browser. Install the wallet or continue in mock verification mode.",
  WALLET_REQUEST_PENDING: "Wallet request already pending. Open your wallet extension, approve or reject the pending request, then retry.",
  WALLET_PROVIDER_CONFLICT: "Multiple wallet providers were detected. Choose the correct wallet extension or retry in a clean browser profile.",
  WALLET_USER_REJECTED: "Wallet connection was rejected. You can retry or continue in mock verification mode.",
  WALLET_BROWSER_UNSUPPORTED: "Wallet providers are unavailable in this browser context. Retry in a supported browser or continue in mock verification mode.",
  WALLET_UNKNOWN_PROVIDER_ERROR: "Wallet provider unavailable in this browser context. Retry in a supported browser or continue in mock verification mode."
};

export function walletErrorMessage(code: WalletErrorCode) {
  return COPY[code];
}

export function createRecoverableWalletError(code: WalletErrorCode): RecoverableWalletError {
  return {
    code,
    severity: "warning",
    message: walletErrorMessage(code)
  };
}

export function mapWalletProviderError(error: unknown): RecoverableWalletError {
  if (!error) {
    return createRecoverableWalletError("WALLET_UNKNOWN_PROVIDER_ERROR");
  }

  const detail = error as { code?: unknown; message?: unknown; name?: unknown };
  const code = typeof detail.code === "number" || typeof detail.code === "string" ? String(detail.code) : "";
  const message = typeof detail.message === "string" ? detail.message : "";
  const name = typeof detail.name === "string" ? detail.name : "";

  if (code === "4001") {
    return createRecoverableWalletError("WALLET_USER_REJECTED");
  }
  if (code === "-32002" || /already pending|request.*pending/i.test(message)) {
    return createRecoverableWalletError("WALLET_REQUEST_PENDING");
  }
  if (/not installed|not exposed|not detected|missing provider/i.test(message)) {
    return createRecoverableWalletError("WALLET_NOT_DETECTED");
  }
  if (/conflict|multiple wallet|provider.*collision|EIP-6963/i.test(`${name} ${message}`)) {
    return createRecoverableWalletError("WALLET_PROVIDER_CONFLICT");
  }
  if (/browser runtime|unsupported browser|window/i.test(message)) {
    return createRecoverableWalletError("WALLET_BROWSER_UNSUPPORTED");
  }

  return createRecoverableWalletError("WALLET_UNKNOWN_PROVIDER_ERROR");
}
