export interface JupiterUltraOrderPayload {
  inAmount?: string;
  outAmount?: string;
  inputMint?: string;
  outputMint?: string;
  error?: string;
}

export interface LifePlusOracleQuote {
  status: "ok";
  source: "jupiter-ultra";
  lifeMint: string;
  usdcMint: string;
  lifeDecimals: number;
  quoteInputRaw: string;
  outAmountUsdcRaw: string;
  usdPrice: number;
  checkedAt: string;
}

function assertUnsignedInteger(value: string | undefined, label: string) {
  if (!value || !/^\d+$/.test(value) || BigInt(value) <= 0n) {
    throw new Error(`Jupiter Ultra returned invalid ${label}.`);
  }
  return value;
}

export function parseLifePlusUltraQuote(input: {
  payload: JupiterUltraOrderPayload | null;
  lifeMint: string;
  usdcMint: string;
  lifeDecimals: number;
  quoteInputRaw: string;
  checkedAt?: string;
}): LifePlusOracleQuote {
  const { payload, lifeMint, usdcMint, lifeDecimals, quoteInputRaw } = input;
  if (!payload) {
    throw new Error("Jupiter Ultra response is empty.");
  }
  if (payload.error) {
    throw new Error(payload.error);
  }

  const inAmount = assertUnsignedInteger(payload.inAmount ?? quoteInputRaw, "inAmount");
  const outAmount = assertUnsignedInteger(payload.outAmount, "outAmount");
  const inputAmountUi = Number(inAmount) / 10 ** lifeDecimals;
  if (!Number.isFinite(inputAmountUi) || inputAmountUi <= 0) {
    throw new Error("Jupiter Ultra quote input cannot be normalized.");
  }

  return {
    status: "ok",
    source: "jupiter-ultra",
    lifeMint,
    usdcMint,
    lifeDecimals,
    quoteInputRaw: inAmount,
    outAmountUsdcRaw: outAmount,
    usdPrice: Number(outAmount) / 10 ** 6 / inputAmountUi,
    checkedAt: input.checkedAt ?? new Date().toISOString()
  };
}
