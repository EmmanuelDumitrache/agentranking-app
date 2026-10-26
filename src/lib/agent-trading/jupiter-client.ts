import "server-only";
import { getAgentTradingConfig } from "@/lib/agent-trading/config";

export type JupiterTokenInfo = {
  id: string;
  name: string;
  symbol: string;
  icon: string | null;
  decimals: number;
  usdPrice: number | null;
  mcap: number | null;
  liquidity: number | null;
};

export type JupiterQuote = {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: unknown[];
};

type JupiterRequestInit = {
  method?: "GET" | "POST";
  path: string;
  body?: unknown;
  signal?: AbortSignal;
};

async function jupiterRequest<T>(input: JupiterRequestInit): Promise<T> {
  const config = getAgentTradingConfig();
  const url = `${config.jupiterBaseUrl.replace(/\/$/, "")}${input.path}`;
  const headers: Record<string, string> = {
    accept: "application/json",
  };
  if (config.jupiterApiKey) {
    headers["x-api-key"] = config.jupiterApiKey;
  }
  if (input.body !== undefined) {
    headers["content-type"] = "application/json";
  }

  const response = await fetch(url, {
    method: input.method ?? "GET",
    headers,
    body: input.body !== undefined ? JSON.stringify(input.body) : undefined,
    signal: input.signal,
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try {
      const parsed = JSON.parse(text) as { error?: string; message?: string };
      message = parsed.error || parsed.message || text;
    } catch {
      // keep raw text
    }
    throw new Error(`Jupiter API error (${response.status}): ${message}`);
  }

  return response.json() as Promise<T>;
}

export async function searchJupiterTokens(
  query: string,
  signal?: AbortSignal,
): Promise<JupiterTokenInfo[]> {
  const q = query.trim();
  if (!q) return [];
  const encoded = encodeURIComponent(q).replace(/%2C/gi, ",");
  const rows = await jupiterRequest<
    Array<{
      id: string;
      name: string;
      symbol: string;
      icon?: string | null;
      decimals: number;
      usdPrice?: number | null;
      mcap?: number | null;
      liquidity?: number | null;
    }>
  >({
    path: `/tokens/v2/search?query=${encoded}`,
    signal,
  });
  return (rows ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    symbol: row.symbol,
    icon: row.icon ?? null,
    decimals: row.decimals,
    usdPrice: row.usdPrice ?? null,
    mcap: row.mcap ?? null,
    liquidity: row.liquidity ?? null,
  }));
}

export async function getJupiterTokenInfo(
  mint: string,
  signal?: AbortSignal,
): Promise<JupiterTokenInfo | null> {
  const rows = await searchJupiterTokens(mint, signal);
  return rows.find((row) => row.id === mint) ?? rows[0] ?? null;
}

export async function getJupiterQuote(input: {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps: number;
  platformFeeBps?: number;
  signal?: AbortSignal;
}): Promise<JupiterQuote> {
  const params = new URLSearchParams({
    inputMint: input.inputMint,
    outputMint: input.outputMint,
    amount: input.amount,
    slippageBps: String(input.slippageBps),
  });
  if (input.platformFeeBps && input.platformFeeBps > 0) {
    params.set("platformFeeBps", String(input.platformFeeBps));
  }
  return jupiterRequest<JupiterQuote>({
    path: `/swap/v1/quote?${params.toString()}`,
    signal: input.signal,
  });
}

export async function getJupiterSwapTransaction(input: {
  quote: JupiterQuote;
  userPublicKey: string;
  feeAccount?: string;
  signal?: AbortSignal;
}): Promise<{ swapTransaction: string; lastValidBlockHeight: number }> {
  const body: Record<string, unknown> = {
    quoteResponse: input.quote,
    userPublicKey: input.userPublicKey,
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: "auto",
  };
  if (input.feeAccount) {
    body.feeAccount = input.feeAccount;
  }
  return jupiterRequest<{ swapTransaction: string; lastValidBlockHeight: number }>({
    method: "POST",
    path: "/swap/v1/swap",
    body,
    signal: input.signal,
  });
}

export async function getJupiterPrices(
  mints: string[],
  signal?: AbortSignal,
): Promise<Record<string, number | null>> {
  if (mints.length === 0) return {};
  const ids = [...new Set(mints.map((m) => m.trim()).filter(Boolean))].join(",");
  const response = await jupiterRequest<
    Record<string, { usdPrice?: number; decimals?: number }>
  >({
    path: `/price/v3?ids=${ids}`,
    signal,
  });
  const result: Record<string, number | null> = {};
  for (const mint of mints) {
    const price = response[mint]?.usdPrice;
    result[mint] = typeof price === "number" && Number.isFinite(price) ? price : null;
  }
  return result;
}
