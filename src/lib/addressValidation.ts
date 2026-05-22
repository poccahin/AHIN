const BASE58_ALPHABET = /^[1-9A-HJ-NP-Za-km-z]+$/;
const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;

export function isLikelySolanaAddress(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= 32 && trimmed.length <= 44 && BASE58_ALPHABET.test(trimmed);
}

export function isLikelyEvmAddress(value: string): boolean {
  return EVM_ADDRESS.test(value.trim());
}

export function shortenAddress(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 12) {
    return trimmed;
  }
  return `${trimmed.slice(0, 5)}...${trimmed.slice(-4)}`;
}
