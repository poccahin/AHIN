import assert from "node:assert/strict";
import {
  calculateCollaborationFeeFallback,
  calculateCollaborationFeeFromQuote,
  verifyNetworkEntryFallback,
  verifyNetworkEntryFromQuote
} from "../src/services/poccConsensus";
import { parseLifePlusUltraQuote } from "../src/lib/jupiterUltra";

const quote = parseLifePlusUltraQuote({
  payload: {
    inAmount: "1000000",
    outAmount: "250000",
    inputMint: "7YdwpERJjzw7UVojxLpvu5ycKBRdYaxaKn4HvoHLpump",
    outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
  },
  lifeMint: "7YdwpERJjzw7UVojxLpvu5ycKBRdYaxaKn4HvoHLpump",
  usdcMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  lifeDecimals: 6,
  quoteInputRaw: "1000000",
  checkedAt: "2026-05-14T00:00:00.000Z"
});

assert.equal(quote.usdPrice, 0.25);
assert.throws(
  () =>
    parseLifePlusUltraQuote({
      payload: { outAmount: "0" },
      lifeMint: quote.lifeMint,
      usdcMint: quote.usdcMint,
      lifeDecimals: 6,
      quoteInputRaw: "1000000"
    }),
  /invalid outAmount/
);
assert.throws(
  () =>
    parseLifePlusUltraQuote({
      payload: { error: "No route" },
      lifeMint: quote.lifeMint,
      usdcMint: quote.usdcMint,
      lifeDecimals: 6,
      quoteInputRaw: "1000000"
    }),
  /No route/
);
assert.throws(
  () =>
    parseLifePlusUltraQuote({
      payload: null,
      lifeMint: quote.lifeMint,
      usdcMint: quote.usdcMint,
      lifeDecimals: 6,
      quoteInputRaw: "1000000"
    }),
  /empty/
);

const passProof = verifyNetworkEntryFromQuote(40_000_000n, quote);
assert.equal(passProof.eligible, true);
assert.equal(passProof.valueUsdcRaw, "10000000");

const failProof = verifyNetworkEntryFromQuote(39_999_999n, quote);
assert.equal(failProof.eligible, false);

const dynamicFee = calculateCollaborationFeeFromQuote(quote);
assert.equal(dynamicFee.amountRaw, "40");
assert.equal(dynamicFee.amountFormatted, "0.00004");

const cappedQuote = { ...quote, outAmountUsdcRaw: "1" };
const cappedFee = calculateCollaborationFeeFromQuote(cappedQuote);
assert.equal(cappedFee.amountRaw, "1000000");

const fallbackProof = verifyNetworkEntryFallback(10_000_000_000n, 6);
assert.equal(fallbackProof.eligible, true);

const fallbackFee = calculateCollaborationFeeFallback(6);
assert.equal(fallbackFee.amountRaw, "1000000");

console.log("PoCC consensus fixtures passed");
