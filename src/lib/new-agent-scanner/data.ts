import "server-only";
import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getPublicApiCached } from "@/lib/public-api-cache";
import { agentPublicPath, toAgentUrlSlug } from "@/lib/agent-public-url";
import { sanitizeAgentImageUrl } from "@/lib/image-utils";
import {
  decodeNewAgentScannerCursor,
  encodeNewAgentScannerCursor,
} from "@/lib/new-agent-scanner/cursor";
import type { NewAgentScannerAgent } from "@/lib/new-agent-scanner/types";
export type NewAgentScannerPageData = {
  agents: NewAgentScannerAgent[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  nextCursor: string | null;
};
const NEW_AGENTS_REVALIDATE_SECONDS = 15;
const NEW_AGENTS_STALE_SECONDS = 60;
const DEFAULT_NEW_AGENTS_PER_PAGE = 20;
const MAX_NEW_AGENTS_PER_PAGE = 50;
const MAX_SCANNER_AGENT_NAME_LENGTH = 1_024;
const MAX_SCANNER_DESCRIPTION_LENGTH = 16_384;
const MAX_SCANNER_METADATA_VALUE_LENGTH = 32_768;
const newAgentScannerSelect = {
  id: true,
  agentId: true,
  chainId: true,
  name: true,
  description: true,
  image: true,
  owner: true,
  score: true,
  rank: true,
  createdAt: true,
  listedAt: true,
  lastActiveAt: true,
  isVerified: true,
  isPremiumVerified: true,
  hasDuplicateName: true,
  x402Support: true,
  sapVerified: true,
  listingRegistrySource: true,
  metaplexVerified: true,
  metaplexAgentTokenMint: true,
  metaplexAssetAddress: true,
  archetype: true,
  protocolTrustScore: true,
  totalFeedback: true,
  agentRankScore: true,
  chain: { select: { name: true, shortName: true, color: true, icon: true } },
  services: { select: { name: true }, take: 1 },
  metadata: { where: { key: "mcpTools" }, select: { key: true, value: true }, take: 1 },
} satisfies Prisma.AgentSelect;
type NewAgentScannerDbAgent = Prisma.AgentGetPayload<{ select: typeof newAgentScannerSelect }>;
type ScannerCoordinateRow = {
  id: number | null;
  listedAt: Date | null;
  total: bigint | number;
};
function dateToIso(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  return value;
}
function clampPage(raw: number): number {
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 1;
}
function clampPerPage(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_NEW_AGENTS_PER_PAGE;
  return Math.min(MAX_NEW_AGENTS_PER_PAGE, Math.max(1, Math.floor(raw)));
}
function boundedString(value: unknown, maxLength: number, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}
function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function safeInteger(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : fallback;
}
function serializeAgent(agent: NewAgentScannerDbAgent): NewAgentScannerAgent {
  const name = boundedString(
    agent.name,
    MAX_SCANNER_AGENT_NAME_LENGTH,
    `Agent ${agent.agentId}`,
  );
  const image = boundedString(sanitizeAgentImageUrl(agent.image), 2_048);
  const metadata = agent.metadata.flatMap((meta) => {
    const key = boundedString(meta.key, 128);
    const value = boundedString(meta.value, MAX_SCANNER_METADATA_VALUE_LENGTH);
    return key && value.length === meta.value.length ? [{ key, value }] : [];
  });
  return {
    id: agent.id,
    agentId: agent.agentId,
    chainId: agent.chainId,
    name,
    description: boundedString(agent.description, MAX_SCANNER_DESCRIPTION_LENGTH) || undefined,
    image: image || undefined,
    owner: boundedString(agent.owner, 512) || undefined,
    score: finiteNumber(agent.score),
    rank: safeInteger(agent.rank),
    slug: toAgentUrlSlug(name),
    profilePath: agentPublicPath({ chainId: agent.chainId, agentId: agent.agentId, name }),
    createdAt: dateToIso(agent.createdAt),
    listedAt: dateToIso(agent.listedAt) ?? null,
    lastActiveAt: dateToIso(agent.lastActiveAt),
    isVerified: agent.isVerified === true,
    isPremiumVerified: agent.isPremiumVerified === true,
    hasDuplicateName: agent.hasDuplicateName === true,
    x402Support: agent.x402Support === true,
    sapVerified: agent.sapVerified === true,
    listingRegistrySource: boundedString(agent.listingRegistrySource, 128) || null,
    metaplexVerified: agent.metaplexVerified === true,
    metaplexAgentTokenMint: boundedString(agent.metaplexAgentTokenMint, 256) || null,
    metaplexAssetAddress: boundedString(agent.metaplexAssetAddress, 256) || null,
    archetype: boundedString(agent.archetype, 128) || null,
    protocolTrustScore: finiteNumber(agent.protocolTrustScore),
    totalFeedback: Math.max(0, safeInteger(agent.totalFeedback)),
    agentRankScore: finiteNumber(agent.agentRankScore),
    chain: {
      name: boundedString(agent.chain.name, 256),
      shortName: boundedString(agent.chain.shortName, 128, String(agent.chainId)),
      color: boundedString(agent.chain.color, 64, "#888"),
      icon: boundedString(agent.chain.icon, 2_048),
    },
    services: agent.services.map((service) => ({
      name: boundedString(service.name, 256),
    })),
    metadata,
  };
}
async function queryNewAgentScannerPage(
  perPageInput: number,
  cursorValue: string | null,
) {
  const perPage = clampPerPage(perPageInput);
  const cursor = decodeNewAgentScannerCursor(cursorValue);
  const cursorDate = cursor?.listedAt ?? null;
  const cursorId = cursor?.id ?? null;
  // The exact total and page coordinates come from one statement. The page uses
  // the indexed (listedAt, id) keyset rather than positional pagination, then only those rows are hydrated.
  const coordinateRows = await prisma.$queryRaw<ScannerCoordinateRow[]>`
    WITH totals AS (
      SELECT COUNT(*)::bigint AS total
      FROM "Agent"
      WHERE "agentId" >= 0 AND "chainId" > 0
    ), page_rows AS (
      SELECT a.id, a."listedAt"
      FROM "Agent" a
      WHERE a."agentId" >= 0
        AND a."chainId" > 0
        AND (
        ${cursorDate}::timestamptz IS NULL
        OR (a."listedAt", a.id) < (${cursorDate}::timestamptz, ${cursorId}::integer)
      )
      ORDER BY a."listedAt" DESC, a.id DESC
      LIMIT ${perPage + 1}
    )
    SELECT page_rows.id, page_rows."listedAt", totals.total
    FROM totals
    LEFT JOIN page_rows ON TRUE
    ORDER BY page_rows."listedAt" DESC NULLS LAST, page_rows.id DESC NULLS LAST
  `;
  const totalRaw = coordinateRows[0]?.total ?? 0;
  const total = Number(totalRaw);
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new Error("New Agent scanner total is outside the safe integer range");
  }
  const coordinates = coordinateRows.filter(
    (row): row is ScannerCoordinateRow & { id: number; listedAt: Date } =>
      Number.isSafeInteger(row.id) && (row.id ?? 0) > 0 && row.listedAt instanceof Date,
  );
  const hasMore = coordinates.length > perPage;
  const visibleCoordinates = hasMore ? coordinates.slice(0, perPage) : coordinates;
  const ids = visibleCoordinates.map((row) => row.id);
  const hydrated = ids.length === 0
    ? []
    : await prisma.agent.findMany({
        where: { id: { in: ids } },
        select: newAgentScannerSelect,
      });
  const byId = new Map(hydrated.map((agent) => [agent.id, agent]));
  const agents = ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [serializeAgent(row)] : [];
  });
  const last = visibleCoordinates.at(-1);
  return {
    agents,
    total,
    perPage,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
    nextCursor: hasMore && last
      ? encodeNewAgentScannerCursor({ listedAt: last.listedAt, id: last.id })
      : null,
  };
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isScannerAgent(value: unknown): value is NewAgentScannerAgent {
  if (!isRecord(value) || !isRecord(value.chain)) return false;
  return (
    typeof value.id === "number" && Number.isSafeInteger(value.id) && value.id > 0 &&
    typeof value.agentId === "number" &&
    Number.isSafeInteger(value.agentId) &&
    value.agentId >= 0 &&
    typeof value.chainId === "number" &&
    Number.isSafeInteger(value.chainId) &&
    value.chainId > 0 &&
    typeof value.name === "string" && value.name.length <= 1_024 &&
    typeof value.profilePath === "string" && value.profilePath.length <= 2_048 &&
    typeof value.score === "number" && Number.isFinite(value.score) &&
    typeof value.chain.shortName === "string" &&
    typeof value.chain.color === "string" &&
    typeof value.chain.icon === "string" &&
    (!Array.isArray(value.services) || value.services.length <= 1) &&
    (!Array.isArray(value.metadata) || value.metadata.length <= 1)
  );
}
function isScannerPageData(
  value: unknown,
): value is Omit<NewAgentScannerPageData, "page"> {
  if (!isRecord(value) || !Array.isArray(value.agents)) return false;
  return (
    value.agents.length <= MAX_NEW_AGENTS_PER_PAGE &&
    value.agents.every(isScannerAgent) &&
    typeof value.total === "number" &&
    Number.isSafeInteger(value.total) &&
    value.total >= 0 &&
    typeof value.perPage === "number" &&
    Number.isSafeInteger(value.perPage) &&
    value.perPage >= 1 &&
    value.perPage <= MAX_NEW_AGENTS_PER_PAGE &&
    typeof value.totalPages === "number" &&
    Number.isSafeInteger(value.totalPages) &&
    value.totalPages >= 1 &&
    (value.nextCursor === null || typeof value.nextCursor === "string")
  );
}
function scannerCacheKey(perPage: number, cursorValue: string | null): string {
  const cursorKey = cursorValue
    ? createHash("sha256").update(cursorValue).digest("hex").slice(0, 24)
    : "first";
  return `new-agent-scanner:${perPage}:${cursorKey}`;
}
export async function getNewAgentScannerPage(
  pageInput: number,
  perPageInput: number,
  cursorValue: string | null = null,
): Promise<NewAgentScannerPageData> {
  if (cursorValue && !decodeNewAgentScannerCursor(cursorValue)) {
    throw new Error("Invalid new Agent scanner cursor");
  }
  const page = clampPage(pageInput);
  const perPage = clampPerPage(perPageInput);
  const result = await getPublicApiCached({
    key: scannerCacheKey(perPage, cursorValue),
    freshTtlSeconds: NEW_AGENTS_REVALIDATE_SECONDS,
    staleTtlSeconds: NEW_AGENTS_STALE_SECONDS,
    maxPayloadBytes: 2 * 1_024 * 1_024,
    leaseTtlMs: 30_000,
    leaseWaitMs: 12_000,
    load: () => queryNewAgentScannerPage(perPage, cursorValue),
    validate: isScannerPageData,
  });
  return { ...result.value, page };
}
