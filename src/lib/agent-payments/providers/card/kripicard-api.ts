import { getKripicardConfig } from "./kripicard-config";

export class KripicardApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "KripicardApiError";
    this.status = status;
    this.body = body;
  }
}

type KripicardEnvelope<T> = {
  success?: boolean;
  message?: string;
  error?: string;
} & T;

export type NormalizedKripicardCardDetails = {
  cardNumber: string;
  cvv: string;
  expiry: string;
  balance: number | null;
  status: string | null;
};

function kripicardBaseUrls(): string[] {
  const primary = getKripicardConfig().apiBaseUrl;
  const fallbacks = [
    "https://api.kripicard.com",
    "https://www.kripicard.com",
    "https://kripicard.com",
  ];
  return [...new Set([primary, ...fallbacks].map((url) => url.replace(/\/$/, "")))];
}

function pickString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function pickNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

/** Normalize flat or nested Kripicard card-details payloads. */
export function normalizeKripicardCardDetails(body: unknown): NormalizedKripicardCardDetails | null {
  if (!body || typeof body !== "object") return null;

  const layers: Record<string, unknown>[] = [body as Record<string, unknown>];
  const data = (body as Record<string, unknown>).data;
  if (data && typeof data === "object") {
    const dataRecord = data as Record<string, unknown>;
    layers.push(dataRecord);
    const details = dataRecord.details;
    if (details && typeof details === "object") {
      layers.push(details as Record<string, unknown>);
    }
  }

  for (const layer of layers) {
    const cardNumber = pickString(layer, [
      "card_number",
      "cardNumber",
      "pan",
      "number",
      "card_no",
    ]);
    const cvv = pickString(layer, ["cvv", "cvc", "security_code", "card_cvv"]);
    const expiry = pickString(layer, ["expiry", "exp", "expiration", "expiry_date", "exp_date"]);
    const balance = pickNumber(layer, ["balance", "amount", "available_balance", "card_balance"]);
    const status = pickString(layer, ["status", "card_status"]);

    if (cardNumber && cvv) {
      return {
        cardNumber,
        cvv,
        expiry: expiry ?? "",
        balance,
        status,
      };
    }
  }

  return null;
}

async function kripicardRequestOnce<T>(
  baseUrl: string,
  path: string,
  options: {
    method: "GET" | "POST";
    payload?: Record<string, unknown>;
  },
): Promise<KripicardEnvelope<T>> {
  const config = getKripicardConfig();
  const pathWithSlash = path.startsWith("/") ? path : `/${path}`;
  let url = `${baseUrl}${pathWithSlash}`;

  if (options.method === "GET" && options.payload) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(options.payload)) {
      if (value != null) params.set(key, String(value));
    }
    url = `${url}?${params.toString()}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method,
      headers: { accept: "application/json" },
      ...(options.method === "POST"
        ? {
            headers: {
              "content-type": "application/json",
              accept: "application/json",
            },
            body: JSON.stringify({ api_key: config.apiKey, ...options.payload }),
          }
        : {}),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Card provider request timed out — check KRIPICARD_API_BASE_URL.");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  let body: unknown;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      body = await response.json();
    } catch {
      body = null;
    }
  } else {
    body = null;
  }

  if (!response.ok || body == null) {
    const record = body as Record<string, unknown> | null;
    const message =
      (typeof record?.message === "string" && record.message) ||
      (typeof record?.error === "string" && record.error) ||
      `Kripicard API error (${response.status})`;
    throw new KripicardApiError(message, response.status, body);
  }

  const envelope = body as KripicardEnvelope<T>;
  if (envelope.success === false) {
    throw new KripicardApiError(
      envelope.message ?? envelope.error ?? "Kripicard request failed",
      response.status,
      body,
    );
  }

  return envelope;
}

async function kripicardPost<T>(
  path: string,
  payload: Record<string, unknown>,
): Promise<KripicardEnvelope<T>> {
  const config = getKripicardConfig();
  if (!config.configured) {
    throw new Error(
      "Kripicard is not configured — set KRIPICARD_API_KEY and KRIPICARD_API_BASE_URL.",
    );
  }

  let lastError: KripicardApiError | null = null;
  for (const baseUrl of kripicardBaseUrls()) {
    try {
      return await kripicardRequestOnce<T>(baseUrl, path, { method: "POST", payload });
    } catch (err) {
      if (err instanceof KripicardApiError && (err.status === 404 || err.status === 405)) {
        lastError = err;
        continue;
      }
      throw err;
    }
  }

  throw lastError ?? new KripicardApiError("Kripicard API unreachable", 502, null);
}

export interface KripicardCreateCardResponse {
  card_id: string;
  last_4: string;
  bin: string;
  amount: number;
  fee?: number;
  total_charged?: number;
}

export interface KripicardFundCardResponse {
  data: {
    card_id: string;
    amount: number;
    fee: number;
    total_debited: number;
  };
}

export interface KripicardDepositCreateResponse {
  data: {
    id: string;
    status: string;
    amount_usd: number;
    fee_usd: number;
    credited_on_completion_usd: number;
    pay_address: string;
    pay_amount: string;
    pay_currency: string;
    network: string;
    expires_at: string;
  };
}

export interface KripicardDepositStatusResponse {
  data: {
    id: string;
    status: "pending" | "completed" | "failed";
    amount_usd: number;
    fee_usd: number;
    credited: boolean;
    credited_amount_usd: number;
    pay_currency: string;
    network: string;
    created_at: string;
  };
}

export interface KripicardTransactionRow {
  date: string;
  type: string;
  merchant: string;
  amount: number;
  currency: string;
  status: string;
}

export function kripicardCreateCard(params: {
  bin: string;
  amountUsd: number;
  nameOnCard: string;
  email?: string;
  dateOfBirth?: string;
}) {
  return kripicardPost<KripicardCreateCardResponse>("/api/external/cards/createcard", {
    bin: params.bin,
    amount: params.amountUsd,
    name_on_card: params.nameOnCard,
    ...(params.email ? { email: params.email } : {}),
    ...(params.dateOfBirth ? { dateOfBirth: params.dateOfBirth } : {}),
  });
}

export function kripicardFundCard(params: { cardId: string; amountUsd: number }) {
  return kripicardPost<KripicardFundCardResponse>("/api/external/cards/fundcard", {
    card_id: params.cardId,
    amount: params.amountUsd,
  });
}

export async function kripicardCardDetails(params: {
  cardId: string;
  lastFour?: string | null;
}): Promise<NormalizedKripicardCardDetails> {
  const config = getKripicardConfig();
  if (!config.configured) {
    throw new Error("Kripicard is not configured — set KRIPICARD_API_KEY.");
  }

  const payload: Record<string, unknown> = { card_id: params.cardId };
  if (params.lastFour) payload.last4 = params.lastFour;

  const attempts: Array<{ method: "GET" | "POST"; path: string }> = [
    { method: "POST", path: "/api/external/cards/carddetails" },
    { method: "GET", path: "/api/external/cards/carddetails" },
    { method: "POST", path: "/api/premium/Get_CardDetails" },
    { method: "POST", path: "/api/premuim/Get_CardDetails" },
  ];

  let lastError: Error | null = null;
  for (const baseUrl of kripicardBaseUrls()) {
    for (const attempt of attempts) {
      try {
        const envelope = await kripicardRequestOnce<Record<string, unknown>>(
          baseUrl,
          attempt.path,
          {
            method: attempt.method,
            payload: { api_key: config.apiKey, ...payload },
          },
        );
        const normalized = normalizeKripicardCardDetails(envelope);
        if (normalized) return normalized;

        const message =
          (typeof envelope.message === "string" && envelope.message) ||
          "Card details response did not include PAN/CVV";
        lastError = new KripicardApiError(message, 502, envelope);
      } catch (err) {
        if (err instanceof KripicardApiError && (err.status === 404 || err.status === 405)) {
          lastError = err;
          continue;
        }
        if (err instanceof Error) {
          lastError = err;
          continue;
        }
      }
    }
  }

  throw (
    lastError ??
    new KripicardApiError("Could not load card details from Kripicard", 502, null)
  );
}

export function kripicardFreezeUnfreeze(params: { cardId: string; action: "freeze" | "unfreeze" }) {
  return kripicardPost<{ message?: string }>("/api/external/premium/Freeze_Unfreeze", {
    card_id: params.cardId,
    action: params.action,
  });
}

export function kripicardDeleteCard(params: { cardId: string }) {
  return kripicardPost<{ refunded?: number; fee?: number; message?: string }>(
    "/api/external/cards/deletecard",
    { card_id: params.cardId },
  );
}

export function kripicardListCards() {
  return kripicardPost<{ total: number; data: Array<Record<string, unknown>> }>(
    "/api/external/cards/list",
    {},
  );
}

export function kripicardCardTransactions(params: { cardId: string }) {
  return kripicardPost<{
    data: {
      card_id: string;
      balance: number;
      total_transactions: number;
      transactions: KripicardTransactionRow[];
    };
  }>("/api/external/cards/transactions", { card_id: params.cardId });
}

export function kripicardDepositCoins() {
  return kripicardPost<{
    data: Array<{ symbol: string; name: string; networks_count: number }>;
  }>("/api/external/deposits/coins", {});
}

export function kripicardDepositNetworks(currency: string) {
  return kripicardPost<{
    data: {
      currency: string;
      networks: Array<{ network: string; name: string; min_amount: number }>;
    };
  }>("/api/external/deposits/networks", { currency });
}

export function kripicardCreateDeposit(params: {
  amountUsd: number;
  currency: string;
  network: string;
  orderId?: string;
}) {
  return kripicardPost<KripicardDepositCreateResponse>("/api/external/deposits/create", {
    amount: params.amountUsd,
    currency: params.currency,
    network: params.network,
    ...(params.orderId ? { order_id: params.orderId } : {}),
  });
}

export function kripicardDepositStatus(depositId: string) {
  return kripicardPost<KripicardDepositStatusResponse>("/api/external/deposits/status", {
    id: depositId,
  });
}

export function parseKripicardExpiry(expiry: string | null | undefined): {
  expiryMonth: number | null;
  expiryYear: number | null;
} {
  const trimmed = (expiry ?? "").trim();
  if (!trimmed) {
    return { expiryMonth: null, expiryYear: null };
  }

  const slash = trimmed.match(/^(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    const month = Number(slash[1]);
    const yearRaw = Number(slash[2]);
    const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
    return {
      expiryMonth: month >= 1 && month <= 12 ? month : null,
      expiryYear: Number.isInteger(year) ? year : null,
    };
  }

  const digits = trimmed.replace(/\D/g, "");
  if (digits.length >= 4) {
    const month = Number(digits.slice(0, 2));
    const year = Number(`20${digits.slice(2, 4)}`);
    return {
      expiryMonth: month >= 1 && month <= 12 ? month : null,
      expiryYear: Number.isInteger(year) ? year : null,
    };
  }

  return { expiryMonth: null, expiryYear: null };
}

export function inferCardBrand(bin: string, cardType?: string): string {
  const normalized = (cardType ?? "").toLowerCase();
  if (normalized.includes("visa")) return "visa";
  if (normalized.includes("master")) return "mastercard";
  if (bin.startsWith("4")) return "visa";
  return "mastercard";
}

export function formatKripicardExpiryDisplay(
  expiry: string,
  expiryMonth: number | null,
  expiryYear: number | null,
): string {
  if (expiry.trim()) return expiry.trim();
  if (expiryMonth && expiryYear) {
    return `${String(expiryMonth).padStart(2, "0")}/${String(expiryYear).slice(-2)}`;
  }
  return "••/••";
}
