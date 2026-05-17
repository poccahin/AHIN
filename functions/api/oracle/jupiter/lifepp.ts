import { parseLifePlusUltraQuote, type JupiterUltraOrderPayload } from "../../../../src/lib/jupiterUltra";
import {
  AHIN_AGENT_ADMISSION_USD_THRESHOLD,
  AHIN_COLLABORATION_USAGE_RULE,
  JUPITER_BASE_URL,
  JUPITER_ULTRA_BASE_URL,
  LIFE_PLUS_MINT,
  PROTOCOL_EXECUTION_ENABLED
} from "../../../../src/config/life-plus";

type CacheStatus = "hit" | "miss_stored" | "miss" | "kv_unavailable" | "kv_error";

interface ReadonlyQuoteKV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

interface PagesEnv extends Record<string, unknown> {
  AHIN_ORACLE_KV?: ReadonlyQuoteKV;
  AHIN_ORACLE_MODE?: string;
  AHIN_PROTOCOL_EXECUTION_ENABLED?: string;
  NEXT_PUBLIC_LIFE_PLUS_DECIMALS?: string;
  JUPITER_API_URL?: string;
  JUPITER_ULTRA_API_URL?: string;
  JUPITER_API_KEY?: string;
}

interface PagesContext {
  env: PagesEnv;
  request: Request;
}

interface ReadonlyQuoteMetadata {
  mode: "readonly";
  protocolExecutionEnabled: false;
  realWalletTransfer: false;
  realBurnTransaction: false;
  admissionThresholdUsd: 10;
  collaborationUsageRule: "min(1 USDT, 1 LIFE++)";
  lifePlusMint: string;
  inputMint: string;
  outputMint: string;
  quoteSource: "jupiter_readonly_proxy";
  cacheStatus: CacheStatus;
  quoteHash: string;
  timestamp: string;
}

interface QuoteSuccessResponseBody extends ReadonlyQuoteMetadata {
  quote: ReturnType<typeof parseLifePlusUltraQuote>;
}

interface QuoteUnavailableResponseBody extends ReadonlyQuoteMetadata {
  status: "quote_unavailable";
  quoteUnavailableReason: "Readonly quote unavailable. You can continue with mock verification.";
}

type QuoteResponseBody = QuoteSuccessResponseBody | QuoteUnavailableResponseBody;

function json(payload: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(payload), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=15, s-maxage=60",
      ...init.headers
    }
  });
}

function envValue(env: PagesEnv, key: keyof PagesEnv, fallback: string) {
  const value = env[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function validateSolanaMint(value: string | null, label: string) {
  if (!value || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) {
    throw new Error(`${label} must be a valid Solana mint address.`);
  }
  return value;
}

function validateAmount(value: string | null) {
  if (!value || !/^\d+$/.test(value) || BigInt(value) <= 0n) {
    throw new Error("amount must be a positive integer in raw token units.");
  }
  return value;
}

function validateSlippageBps(value: string | null) {
  if (value === null) {
    return "50";
  }
  if (!/^\d+$/.test(value)) {
    throw new Error("slippageBps must be an integer.");
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 1_000) {
    throw new Error("slippageBps must be between 0 and 1000.");
  }
  return parsed.toString();
}

function readLifeDecimals(env: PagesEnv) {
  const configured = envValue(env, "NEXT_PUBLIC_LIFE_PLUS_DECIMALS", "6");
  if (!/^\d+$/.test(configured)) {
    throw new Error("NEXT_PUBLIC_LIFE_PLUS_DECIMALS must be an integer.");
  }
  return Number.parseInt(configured, 10);
}

async function sha256Hex(value: unknown) {
  const data = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readCachedQuote(kv: ReadonlyQuoteKV | undefined, cacheKey: string) {
  if (!kv) {
    return null;
  }
  const cached = await kv.get(cacheKey);
  if (!cached) {
    return null;
  }
  return JSON.parse(cached) as QuoteResponseBody;
}

function createBaseMetadata(input: {
  inputMint: string;
  outputMint: string;
  cacheStatus: CacheStatus;
  quoteHash: string;
  timestamp: string;
}): ReadonlyQuoteMetadata {
  return {
    mode: "readonly",
    protocolExecutionEnabled: false,
    realWalletTransfer: false,
    realBurnTransaction: false,
    admissionThresholdUsd: AHIN_AGENT_ADMISSION_USD_THRESHOLD,
    collaborationUsageRule: AHIN_COLLABORATION_USAGE_RULE,
    lifePlusMint: LIFE_PLUS_MINT,
    inputMint: input.inputMint,
    outputMint: input.outputMint,
    quoteSource: "jupiter_readonly_proxy",
    cacheStatus: input.cacheStatus,
    quoteHash: input.quoteHash,
    timestamp: input.timestamp
  };
}

async function createUnavailableBody(input: {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps: string;
  cacheStatus: CacheStatus;
  reason: "upstream" | "parse" | "unsupported_route";
}) {
  const timestamp = new Date().toISOString();
  const quoteHash = await sha256Hex({
    mode: "readonly",
    status: "quote_unavailable",
    inputMint: input.inputMint,
    outputMint: input.outputMint,
    amount: input.amount,
    slippageBps: input.slippageBps,
    reason: input.reason
  });
  return {
    ...createBaseMetadata({
      inputMint: input.inputMint,
      outputMint: input.outputMint,
      cacheStatus: input.cacheStatus,
      quoteHash,
      timestamp
    }),
    status: "quote_unavailable",
    quoteUnavailableReason: "Readonly quote unavailable. You can continue with mock verification."
  } satisfies QuoteUnavailableResponseBody;
}

export async function onRequest(context: PagesContext) {
  if (context.request.method !== "GET") {
    return json({ error: "Method not allowed. Use GET for readonly LIFE++ oracle quotes." }, { status: 405 });
  }

  const oracleMode = envValue(context.env, "AHIN_ORACLE_MODE", "readonly");
  const protocolExecutionEnabled = envValue(context.env, "AHIN_PROTOCOL_EXECUTION_ENABLED", PROTOCOL_EXECUTION_ENABLED ? "true" : "false");
  if (oracleMode !== "readonly" || protocolExecutionEnabled !== "false" || PROTOCOL_EXECUTION_ENABLED) {
    return json({ error: "Oracle proxy is not in readonly fail-closed mode." }, { status: 503 });
  }

  try {
    const requestUrl = new URL(context.request.url);
    const lifeMint = LIFE_PLUS_MINT;
    const inputMint = validateSolanaMint(requestUrl.searchParams.get("inputMint"), "inputMint");
    const outputMint = validateSolanaMint(requestUrl.searchParams.get("outputMint") ?? lifeMint, "outputMint");
    const amount = validateAmount(requestUrl.searchParams.get("amount"));
    const slippageBps = validateSlippageBps(requestUrl.searchParams.get("slippageBps"));
    const cacheKey = `lifepp:readonly:v2:${inputMint}:${outputMint}:${amount}:${slippageBps}`;

    let cacheStatus: CacheStatus = "kv_unavailable";
    try {
      const cached = await readCachedQuote(context.env.AHIN_ORACLE_KV, cacheKey);
      if (cached) {
        return json({ ...cached, cacheStatus: "hit", timestamp: new Date().toISOString() });
      }
      cacheStatus = context.env.AHIN_ORACLE_KV ? "miss" : "kv_unavailable";
    } catch {
      cacheStatus = "kv_error";
    }

    const parseAsLifePlusToUsd = inputMint === lifeMint && outputMint !== lifeMint;

    const jupiterApiUrl = envValue(context.env, "JUPITER_API_URL", JUPITER_BASE_URL).replace(/\/+$/, "");
    const jupiterUltraApiUrl = envValue(context.env, "JUPITER_ULTRA_API_URL", JUPITER_ULTRA_BASE_URL).replace(/\/+$/, "");
    const quoteUrl = new URL("v1/order", `${jupiterUltraApiUrl || `${jupiterApiUrl}/ultra`}/`);
    quoteUrl.searchParams.set("inputMint", inputMint);
    quoteUrl.searchParams.set("outputMint", outputMint);
    quoteUrl.searchParams.set("amount", amount);
    quoteUrl.searchParams.set("slippageBps", slippageBps);

    const headers: Record<string, string> = { Accept: "application/json" };
    if (typeof context.env.JUPITER_API_KEY === "string" && context.env.JUPITER_API_KEY.trim()) {
      headers["x-api-key"] = context.env.JUPITER_API_KEY.trim();
    }

    const response = await fetch(quoteUrl, { headers });
    const payload = (await response.json().catch(() => null)) as JupiterUltraOrderPayload | null;
    if (!response.ok) {
      return json(await createUnavailableBody({ inputMint, outputMint, amount, slippageBps, cacheStatus, reason: "upstream" }));
    }

    if (!parseAsLifePlusToUsd) {
      return json(await createUnavailableBody({ inputMint, outputMint, amount, slippageBps, cacheStatus, reason: "unsupported_route" }));
    }

    const timestamp = new Date().toISOString();
    let quote: ReturnType<typeof parseLifePlusUltraQuote>;
    try {
      quote = parseLifePlusUltraQuote({
        payload,
        lifeMint,
        usdcMint: outputMint,
        lifeDecimals: readLifeDecimals(context.env),
        quoteInputRaw: amount,
        checkedAt: timestamp
      });
    } catch {
      return json(await createUnavailableBody({ inputMint, outputMint, amount, slippageBps, cacheStatus, reason: "parse" }));
    }
    const quoteHash = await sha256Hex({ inputMint, outputMint, amount, slippageBps, quote });
    const body: QuoteSuccessResponseBody = {
      ...createBaseMetadata({ inputMint, outputMint, cacheStatus, quoteHash, timestamp }),
      quote
    };

    if (context.env.AHIN_ORACLE_KV && cacheStatus !== "kv_error") {
      try {
        await context.env.AHIN_ORACLE_KV.put(cacheKey, JSON.stringify({ ...body, cacheStatus: "miss_stored" }), {
          expirationTtl: 60
        });
        body.cacheStatus = "miss_stored";
      } catch {
        body.cacheStatus = "kv_error";
      }
    }

    return json(body);
  } catch {
    return json({ error: "Invalid LIFE++ readonly quote request." }, { status: 400 });
  }
}
