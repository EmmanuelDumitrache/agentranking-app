"use client";

import {
  keepPreviousData,
  useQuery,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { fetchJsonWithQuerySignal } from "@/lib/fetch-with-query-signal";
import { treasuryKeys } from "@/lib/query-keys/treasury";
import type { ArCardBinOption } from "@/lib/agent-payments/providers/card/ar-card-bins";

type QueryHookOptions<T> = Omit<UseQueryOptions<T>, "queryKey" | "queryFn">;

export type TreasuryAgent = {
  id: number;
  name: string;
  image?: string | null;
};

export type TreasuryWalletConfig = {
  fundingProvider: string;
  cardIssuerProvider: string;
  oneCardPerAccount?: boolean;
  demoFlow?: boolean;
  bins?: ArCardBinOption[];
  issuance: { devBypassActive: boolean; demoFlowActive?: boolean };
  kripicard: {
    configured: boolean;
    defaultCurrency: string;
    defaultNetwork: string;
    defaultBin?: string;
    minCardUsd: number;
    minFundUsd: number;
  };
};

export type TreasuryCard = {
  id: string;
  lastFour: string;
  brand: string;
  status: string;
  bin?: string;
  nameOnCard?: string;
  balanceUsd?: number;
  initialAmountUsd?: number;
  pinSet?: boolean;
  createdAt?: string;
};

export type TreasuryCardIssuanceState = {
  feeCents: number;
  currency: string;
  devBypassActive: boolean;
  requiresPayment: boolean;
  canAfford: boolean;
};

export type TreasuryWalletBalance = {
  balanceUsdcCents: number;
  reservedUsdcCents: number;
  availableUsdcCents: number;
  status: string;
};

export type TreasuryCardState = {
  card?: TreasuryCard | null;
  cards?: TreasuryCard[];
  issuance?: TreasuryCardIssuanceState | null;
  balance?: TreasuryWalletBalance | null;
};

export type TreasuryTransaction = {
  id: string;
  type: string;
  amountCents: number;
  merchant: string | null;
  category: string | null;
  status: string;
  createdAt: string;
  agent?: { id: number; name: string } | null;
};

export type TreasuryAgentTransactions = {
  summary: { totalSpentCents: number; spendCount: number };
};

export type TreasuryPolicy = {
  dailyLimitCents: number;
  weeklyLimitCents: number;
  monthlyLimitCents: number;
  allowedCategories: string[];
  blockedCategories: string[];
  allowManualUsage: boolean;
  allowAgentUsage: boolean;
};

function readWalletConfig(signal: AbortSignal): Promise<TreasuryWalletConfig> {
  return fetchJsonWithQuerySignal("/api/wallet/config", signal);
}

function readWalletAgents(signal: AbortSignal): Promise<{ agents: TreasuryAgent[] }> {
  return fetchJsonWithQuerySignal("/api/wallet/agents", signal);
}

function readWalletBalance(
  signal: AbortSignal,
): Promise<{ balance: TreasuryWalletBalance }> {
  return fetchJsonWithQuerySignal("/api/wallet/balance", signal);
}

function readCards(signal: AbortSignal): Promise<TreasuryCardState> {
  return fetchJsonWithQuerySignal("/api/cards", signal);
}

function readAgentCard(
  agentId: number,
  signal: AbortSignal,
): Promise<TreasuryCardState> {
  return fetchJsonWithQuerySignal(
    `/api/treasury/agents/${agentId}/card`,
    signal,
  );
}

function readAgentTransactions(
  agentId: number,
  limit: number,
  signal: AbortSignal,
): Promise<TreasuryAgentTransactions> {
  return fetchJsonWithQuerySignal(
    `/api/treasury/agents/${agentId}/transactions?limit=${limit}`,
    signal,
  );
}

function readStripeIssuingAgent(
  agentId: number,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  return fetchJsonWithQuerySignal(`/api/stripe/issuing/agents/${agentId}`, signal);
}

function readPolicies(signal: AbortSignal): Promise<{ policy: TreasuryPolicy }> {
  return fetchJsonWithQuerySignal("/api/policies", signal);
}

export function useTreasuryWalletConfig(options?: QueryHookOptions<TreasuryWalletConfig>) {
  return useQuery({
    queryKey: treasuryKeys.walletConfig(),
    queryFn: ({ signal }) => readWalletConfig(signal),
    staleTime: 5 * 60 * 1000,
    ...options,
  });
}

export function useTreasuryWalletAgents(
  options?: QueryHookOptions<{ agents: TreasuryAgent[] }>,
) {
  return useQuery({
    queryKey: treasuryKeys.walletAgents(),
    queryFn: ({ signal }) => readWalletAgents(signal),
    staleTime: 60 * 1000,
    ...options,
  });
}

export function useTreasuryWalletBalance(
  options?: QueryHookOptions<{ balance: TreasuryWalletBalance }>,
) {
  return useQuery({
    queryKey: treasuryKeys.walletBalance(),
    queryFn: ({ signal }) => readWalletBalance(signal),
    staleTime: 15 * 1000,
    ...options,
  });
}

export function useTreasuryTransactions(
  filters: {
    merchant?: string;
    status?: string;
    category?: string;
    limit?: number;
  },
  options?: QueryHookOptions<{ items: TreasuryTransaction[] }>,
) {
  const limit = filters.limit ?? 50;
  return useQuery({
    queryKey: treasuryKeys.walletTransactions({
      limit,
      merchant: filters.merchant?.trim() || undefined,
      status: filters.status?.trim() || undefined,
      category: filters.category?.trim() || undefined,
    }),
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ limit: String(limit) });
      if (filters.merchant?.trim()) params.set("merchant", filters.merchant.trim());
      if (filters.status?.trim()) params.set("status", filters.status.trim());
      if (filters.category?.trim()) params.set("category", filters.category.trim());
      return fetchJsonWithQuerySignal<{ items: TreasuryTransaction[] }>(
        `/api/wallet/transactions?${params}`,
        signal,
      );
    },
    placeholderData: keepPreviousData,
    staleTime: 15 * 1000,
    ...options,
  });
}

export function useTreasuryCards(options?: QueryHookOptions<TreasuryCardState>) {
  return useQuery({
    queryKey: treasuryKeys.cards(),
    queryFn: ({ signal }) => readCards(signal),
    staleTime: 30 * 1000,
    ...options,
  });
}

export function useTreasuryAgentCard(
  agentId: number | null,
  options?: QueryHookOptions<TreasuryCardState>,
) {
  return useQuery({
    queryKey: treasuryKeys.agentCard(agentId ?? 0),
    queryFn: ({ signal }) => readAgentCard(agentId!, signal),
    enabled: agentId != null,
    staleTime: 30 * 1000,
    ...options,
  });
}

export function useTreasuryAgentTransactions(
  agentId: number | null,
  limit = 5,
  options?: QueryHookOptions<TreasuryAgentTransactions>,
) {
  return useQuery({
    queryKey: treasuryKeys.agentTransactions(agentId ?? 0, limit),
    queryFn: ({ signal }) => readAgentTransactions(agentId!, limit, signal),
    enabled: agentId != null,
    staleTime: 15 * 1000,
    ...options,
  });
}

export function useStripeIssuingAgentState(
  agentId: number | null,
  options?: QueryHookOptions<Record<string, unknown>>,
) {
  return useQuery({
    queryKey: treasuryKeys.stripeIssuingAgent(agentId ?? 0),
    queryFn: ({ signal }) => readStripeIssuingAgent(agentId!, signal),
    enabled: agentId != null,
    staleTime: 30 * 1000,
    ...options,
  });
}

export function useTreasuryPolicies(
  options?: QueryHookOptions<{ policy: TreasuryPolicy }>,
) {
  return useQuery({
    queryKey: treasuryKeys.policies(),
    queryFn: ({ signal }) => readPolicies(signal),
    staleTime: 60 * 1000,
    ...options,
  });
}