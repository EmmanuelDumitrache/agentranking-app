import "server-only";

import { getAgentCardConfig } from "./config";

export class AgentCardApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "AgentCardApiError";
  }
}

export interface AgentCardMe {
  email: string;
  agentEmail?: string | null;
  walletAddress?: string | null;
  spendLimitCents?: number;
  paymentMethod?: {
    brand: string;
    last4: string;
  } | null;
}

export interface AgentCardLimits {
  spendLimitCents: number;
  spentCents: number;
  remainingCents: number;
}

export interface AgentCardIdentityStatus {
  identityVerificationStatus?: string;
  identityVerificationRequired?: boolean;
}

export interface AgentCardPurchaseSummary {
  id: string;
  kind: string;
  amountCents: number;
  status: string;
  sourceStatus?: string;
  createdAt: string;
  expiresAt: string;
  last4?: string | null;
  merchant?: { name: string; url?: string } | null;
  item?: string | null;
}

export interface AgentCardIssuedCardDetails {
  id: string;
  amountCents: number;
  expiresAt: string;
  status: string;
  last4?: string;
  pan?: string;
  cvv?: string;
  expiryMonth?: number;
  expiryYear?: number;
  zip?: string;
  cardholderName?: string;
  billingAddress?: string;
}

export interface AgentCardThreeDsCode {
  code: string;
  match?: string;
  merchant?: string;
  amountCents?: number;
  currency?: string;
  reasons?: string[];
}

async function agentCardFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const config = getAgentCardConfig();
  if (!config.apiToken) {
    throw new AgentCardApiError("AgentCard is not configured", 503, "not_configured");
  }

  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiToken}`,
      ...(init.headers ?? {}),
    },
  });

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = text;
    }
  }

  if (response.status === 401) {
    throw new AgentCardApiError(
      "AgentCard session expired — update AGENTCARD_API_TOKEN",
      401,
      "session_expired",
      body,
    );
  }

  if (!response.ok) {
    const record =
      body && typeof body === "object" ? (body as Record<string, unknown>) : null;
    const message =
      typeof record?.error === "string"
        ? record.error
        : typeof record?.message === "string"
          ? record.message
          : `AgentCard API ${response.status}`;
    const code = typeof record?.code === "string" ? record.code : undefined;
    throw new AgentCardApiError(message, response.status, code, body);
  }

  return body as T;
}

export async function getAgentCardMe(): Promise<AgentCardMe> {
  return agentCardFetch<AgentCardMe>("/api/me");
}

export async function getAgentCardLimits(): Promise<AgentCardLimits> {
  return agentCardFetch<AgentCardLimits>("/api/limits");
}

export async function getAgentCardIdentityStatus(): Promise<AgentCardIdentityStatus> {
  return agentCardFetch<AgentCardIdentityStatus>("/api/identity/verification-session");
}

export function getAgentCardIdentityUrl(apiToken: string): string {
  const config = getAgentCardConfig();
  return `${config.apiBaseUrl}/identity#identity_token=${encodeURIComponent(apiToken)}`;
}

export async function getAgentCardReadiness(): Promise<{
  configured: boolean;
  signedIn: boolean;
  paymentMethodReady: boolean;
  agentEmailReady: boolean;
  walletReady: boolean;
  identityStatus: string;
  identityRequired: boolean;
  identityUrl: string | null;
  spendReady: boolean;
  email: string | null;
  agentEmail: string | null;
  limits: AgentCardLimits | null;
  messages: string[];
}> {
  const config = getAgentCardConfig();
  const messages: string[] = [];

  if (!config.enabled || !config.apiToken) {
    return {
      configured: false,
      signedIn: false,
      paymentMethodReady: false,
      agentEmailReady: false,
      walletReady: false,
      identityStatus: "unknown",
      identityRequired: false,
      identityUrl: null,
      spendReady: false,
      email: null,
      agentEmail: null,
      limits: null,
      messages: ["Set AGENTCARD_API_TOKEN (from `~/.agentcard/config.json` after `agentcard signup`)."],
    };
  }

  const [me, identity, limitsResult] = await Promise.all([
    getAgentCardMe(),
    getAgentCardIdentityStatus(),
    getAgentCardLimits().then(
      (limits) => ({ ok: true as const, limits }),
      () => ({ ok: false as const, limits: null }),
    ),
  ]);
  const limits = limitsResult.limits;
  if (!limitsResult.ok) messages.push("Could not load AgentCard spend limits.");

  const paymentMethodReady = Boolean(me.paymentMethod);
  const agentEmailReady = Boolean(me.agentEmail);
  const walletReady = Boolean(me.walletAddress);

  if (!paymentMethodReady) messages.push("Add a payment method via `agentcard setup`.");
  if (!agentEmailReady) messages.push("Provision agent email via `agentcard setup`.");
  if (!walletReady) messages.push("Provision Base wallet via `agentcard setup`.");

  const identityStatus = identity.identityVerificationStatus ?? "unknown";
  const identityRequired =
    identity.identityVerificationRequired !== false &&
    identityStatus !== "verified" &&
    identityStatus !== "exempt";

  const identityUrl = identityRequired ? getAgentCardIdentityUrl(config.apiToken) : null;
  if (identityRequired) {
    messages.push("Complete KYC before first spend.");
  }

  const spendReady =
    paymentMethodReady &&
    agentEmailReady &&
    walletReady &&
    !identityRequired;

  return {
    configured: true,
    signedIn: true,
    paymentMethodReady,
    agentEmailReady,
    walletReady,
    identityStatus,
    identityRequired,
    identityUrl,
    spendReady,
    email: me.email ?? null,
    agentEmail: me.agentEmail ?? null,
    limits,
    messages,
  };
}

export async function createAgentCardSpendRequest(amountCents: number): Promise<AgentCardIssuedCardDetails> {
  return agentCardFetch<AgentCardIssuedCardDetails>("/api/spend-requests", {
    method: "POST",
    body: JSON.stringify({ amountCents }),
  });
}

export async function listAgentCardPurchases(): Promise<AgentCardPurchaseSummary[]> {
  const res = await agentCardFetch<{ purchases?: AgentCardPurchaseSummary[] }>(
    "/api/purchases",
  );
  return res.purchases ?? [];
}

export async function getAgentCardPurchase(id: string): Promise<AgentCardPurchaseSummary> {
  const res = await agentCardFetch<{ purchase: AgentCardPurchaseSummary }>(
    `/api/purchases/${encodeURIComponent(id)}`,
  );
  return res.purchase;
}

export async function getAgentCardSpendRequest(
  id: string,
  includeCredentials: boolean,
): Promise<AgentCardIssuedCardDetails> {
  const req = await agentCardFetch<AgentCardIssuedCardDetails>(
    `/api/spend-requests/${encodeURIComponent(id)}`,
  );
  if (!includeCredentials) {
    return {
      id: req.id,
      amountCents: req.amountCents,
      expiresAt: req.expiresAt,
      status: req.status,
      last4: req.last4,
    };
  }
  return req;
}

export async function cancelAgentCardSpendRequest(id: string): Promise<AgentCardIssuedCardDetails> {
  return agentCardFetch<AgentCardIssuedCardDetails>(
    `/api/spend-requests/${encodeURIComponent(id)}/cancel`,
    { method: "POST", body: JSON.stringify({}) },
  );
}

export async function listAgentCardThreeDsCodes(params?: {
  purchaseId?: string;
  merchant?: string;
  amountCents?: number;
}): Promise<AgentCardThreeDsCode[]> {
  const search = new URLSearchParams();
  if (params?.purchaseId) search.set("cardId", params.purchaseId);
  if (params?.merchant) search.set("merchant", params.merchant);
  if (params?.amountCents != null) search.set("amountCents", String(params.amountCents));

  const query = search.toString();
  const res = await agentCardFetch<{ codes?: AgentCardThreeDsCode[] }>(
    `/api/3ds-codes${query ? `?${query}` : ""}`,
  );
  return res.codes ?? [];
}

export async function getAgentCardWalletBalance(): Promise<{
  walletAddress: string | null;
  balanceUsdc: string | null;
}> {
  const me = await getAgentCardMe();
  return {
    walletAddress: me.walletAddress ?? null,
    balanceUsdc: null,
  };
}
