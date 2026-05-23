'use client';

/**
 * Hex utility — produces a pseudo-SHA-256 string that rotates over time
 * with character-level diff cycling. Used by the ProtocolEvidencePanel to
 * convey "live rolling cryptographic root."
 *
 * Two helpers:
 *   - rollingHexHash(seed, time): a 64-char hex string that mutates slowly
 *     over time. Some characters cycle fast, most cycle slow — produces the
 *     "mostly stable hash with a couple characters scrolling" effect.
 *   - makeProofHash(): one-shot random 64-char hex string for evidence
 *     stream entries.
 *
 * No crypto dependency — these are visual props, not real hashes.
 */

const HEX = '0123456789abcdef';

/**
 * Deterministic pseudo-random for a (key, time) pair. Stable for the same
 * inputs — used so each character at index i has a deterministic value
 * relative to its own internal clock rate.
 */
function pseudoRand(key: number, time: number): number {
  const t = Math.floor(time);
  const a = Math.sin(key * 12.9898 + t * 78.233) * 43758.5453123;
  return a - Math.floor(a); // [0, 1)
}

/**
 * Compose a 64-char hex string. Each character has its own update rate:
 *   - About 60% of chars are "slow" (update every 4-10 seconds)
 *   - About 30% are "medium" (every 1-2 seconds)
 *   - About 10% are "fast" (multiple times per second)
 *
 * The mix gives the effect of a mostly stable hash with a handful of
 * actively-cycling characters — exactly the boardroom-grade
 * "cryptographic root that's almost-but-not-quite settled" feel.
 */
export function rollingHexHash(time: number): string {
  let out = '';
  for (let i = 0; i < 64; i++) {
    // Per-char update rate, deterministic by index.
    const rateRoll = pseudoRand(i * 7.31, 0);
    let rate: number;
    if (rateRoll < 0.6) rate = 0.1 + pseudoRand(i, 1) * 0.15;       // 0.1..0.25 Hz
    else if (rateRoll < 0.9) rate = 0.5 + pseudoRand(i, 2) * 0.6;   // 0.5..1.1 Hz
    else rate = 2 + pseudoRand(i, 3) * 6;                            // 2..8 Hz

    const phase = i * 31.7;
    const cellIdx = Math.floor(time * rate + phase);
    const r = pseudoRand(i + 0.5, cellIdx);
    out += HEX[Math.floor(r * 16)];
  }
  return out;
}

/**
 * Generate a one-shot pseudo-hash for an evidence stream entry. Not
 * time-varying — once created, the string is stable.
 */
export function makeProofHash(): string {
  let out = '';
  for (let i = 0; i < 64; i++) {
    out += HEX[Math.floor(Math.random() * 16)];
  }
  return out;
}

/** Short-form (first N + ... + last N chars) for compact display. */
export function shortenHash(h: string, n = 6): string {
  if (h.length <= n * 2 + 3) return h;
  return `${h.slice(0, n)}…${h.slice(-n)}`;
}
