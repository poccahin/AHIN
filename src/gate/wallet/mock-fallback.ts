export type MockFallbackState =
  | "wallet_connected_mock"
  | "asset_detected_mock"
  | "signature_verified_mock"
  | "matrix_revealing"
  | "matrix_active";

export const MOCK_FALLBACK_DISCLOSURE =
  "Readonly / mock verification only · No real wallet balance checked unless explicitly connected · No LIFE++ transferred or burned";

export const MOCK_FALLBACK_STATES: readonly MockFallbackState[] = [
  "wallet_connected_mock",
  "asset_detected_mock",
  "signature_verified_mock",
  "matrix_revealing",
  "matrix_active"
];

export function runMockFallbackTimeline(onState: (state: MockFallbackState) => void) {
  MOCK_FALLBACK_STATES.forEach(onState);
  return MOCK_FALLBACK_STATES[MOCK_FALLBACK_STATES.length - 1];
}

export function isMockFallbackComplete(states: readonly MockFallbackState[]) {
  return states.includes("matrix_active");
}
