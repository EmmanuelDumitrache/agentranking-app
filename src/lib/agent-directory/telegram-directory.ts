import { resolveAgentListSearchForApi } from "@/lib/agents-search-scope";
export type TelegramDirectoryQuery = {
  page: number;
  perPage: number;
  search: string;
  sort: string;
  verified: string;
  botType: string;
  spawn: string;
  tag: string;
};
export type TelegramDirectoryAgentDto = {
  agentId: number;
  chainId: number;
  name: string;
  description: string;
  image: string | null;
  score: number;
  createdAt: string;
  slug: string;
  profilePath: string;
  isVerified: boolean;
  isPremiumVerified: boolean;
  metadata: Array<{ key: string; value: string }>;
};
export type TelegramDirectoryResponse = {
  agents: TelegramDirectoryAgentDto[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  generatedAt: string;
};
type SearchParamRecord = Record<string, string | string[] | undefined>;
function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}
function positiveInt(raw: string, fallback: number, max: number): number {
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}
export function normalizeTelegramDirectoryQuery(params: SearchParamRecord): TelegramDirectoryQuery {
  const botType = first(params.telegramBotType);
  return {
    page: positiveInt(first(params.page), 1, 10_000),
    perPage: positiveInt(first(params.perPage), 50, 100),
    search: resolveAgentListSearchForApi(first(params.search)).slice(0, 120),
    sort: first(params.sort) || "profile_desc",
    verified: first(params.verified) === "true" ? "true" : "",
    botType: botType === "standalone" || botType === "managed" ? botType : "",
    spawn: first(params.telegramSpawn) === "true" ? "true" : "",
    tag: first(params.tag).trim().slice(0, 80),
  };
}
export function telegramDirectoryQueryKey(input: TelegramDirectoryQuery): readonly unknown[] {
  return [
    "telegram-directory",
    input.page,
    input.sort,
    input.search,
    String(input.perPage),
    input.verified,
    input.botType,
    input.spawn,
    input.tag,
  ];
}
