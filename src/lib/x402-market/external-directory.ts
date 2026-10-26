import { mapWithConcurrency } from "@/lib/async-pool";
import {
  readExternalProviderCache,
  writeExternalProviderCache,
  type ExternalProviderCacheRead,
} from "@/lib/external-provider-cache";
import { fetchPublicJson } from "@/lib/outbound-http";
const BASE_URL = "https://x402-list.com/api/v1/services";
const CACHE_KEY = "x402-directory:snapshot";
const PAGE_SIZE = 100;
const MAX_PAGES = 25;
const MAX_ROWS = PAGE_SIZE * MAX_PAGES;
const PAGE_CONCURRENCY = 4;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
const FRESH_SECONDS = 15 * 60;
const STALE_SECONDS = 24 * 60 * 60;
const JOB_TIMEOUT_MS = 120_000;
export type X402DirectoryRow = {
  slug: string;
  name: string;
  description: string;
  base_url: string;
  website_url: string | null;
  category: string;
  status: string;
  verified: boolean;
  endpoint_count: number;
  min_price_usd: number | null;
  networks: string[];
  assessment?: { summary?: { value?: string }; compliance_grade?: string };
};
export type X402DirectorySnapshot = {
  version: 1;
  fetchedAt: string;
  rows: X402DirectoryRow[];
  providerTotal: number;
};
type DirectoryPage = { data?: unknown[]; meta?: { total?: unknown } };
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function urlText(value: unknown): string {
  const candidate = text(value, 2_048);
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" ? url.toString() : "";
  } catch { return ""; }
}
function normalizeRow(value: unknown): X402DirectoryRow | null {
  if (!isRecord(value)) return null;
  const slug = text(value.slug, 160);
  const name = text(value.name, 300);
  const baseUrl = urlText(value.base_url);
  const websiteUrl = urlText(value.website_url);
  if (!slug || !name || !baseUrl) return null;
  const assessment = isRecord(value.assessment) ? value.assessment : null;
  const summary = assessment && isRecord(assessment.summary)
    ? text(assessment.summary.value, 2_000)
    : "";
  const minPrice = typeof value.min_price_usd === "number" && Number.isFinite(value.min_price_usd)
    ? Math.max(0, value.min_price_usd)
    : null;
  return {
    slug,
    name,
    description: text(value.description, 4_000),
    base_url: baseUrl,
    website_url: websiteUrl || null,
    category: text(value.category, 120),
    status: text(value.status, 80).toLowerCase(),
    verified: value.verified === true,
    endpoint_count: Number.isSafeInteger(value.endpoint_count)
      ? Math.max(0, Math.min(10_000, Number(value.endpoint_count)))
      : 0,
    min_price_usd: minPrice,
    networks: Array.isArray(value.networks)
      ? value.networks.slice(0, 32).map((item) => text(item, 120)).filter(Boolean)
      : [],
    ...(summary || (assessment && text(assessment.compliance_grade, 80)) ? {
      assessment: {
        ...(summary ? { summary: { value: summary } } : {}),
        ...(assessment ? { compliance_grade: text(assessment.compliance_grade, 80) } : {}),
      },
    } : {}),
  };
}
function isNormalizedAssessment(value: unknown): value is NonNullable<X402DirectoryRow["assessment"]> {
  if (!isRecord(value)) return false;
  if (value.compliance_grade !== undefined && (typeof value.compliance_grade !== "string" || value.compliance_grade.length > 80)) {
    return false;
  }
  if (value.summary !== undefined) {
    if (!isRecord(value.summary) || typeof value.summary.value !== "string" || value.summary.value.length > 2_000) {
      return false;
    }
  }
  return true;
}
function isNormalizedRow(value: unknown): value is X402DirectoryRow {
  if (!isRecord(value)) return false;
  if (typeof value.slug !== "string" || !value.slug || value.slug.length > 160) return false;
  if (typeof value.name !== "string" || !value.name || value.name.length > 300) return false;
  if (typeof value.description !== "string" || value.description.length > 4_000) return false;
  if (typeof value.base_url !== "string" || urlText(value.base_url) !== value.base_url) return false;
  if (value.website_url !== null && (typeof value.website_url !== "string" || urlText(value.website_url) !== value.website_url)) return false;
  if (typeof value.category !== "string" || value.category.length > 120) return false;
  if (typeof value.status !== "string" || value.status.length > 80 || value.status !== value.status.toLowerCase()) return false;
  if (typeof value.verified !== "boolean") return false;
  if (!Number.isSafeInteger(value.endpoint_count) || Number(value.endpoint_count) < 0 || Number(value.endpoint_count) > 10_000) return false;
  if (value.min_price_usd !== null && (typeof value.min_price_usd !== "number" || !Number.isFinite(value.min_price_usd) || value.min_price_usd < 0)) return false;
  if (!Array.isArray(value.networks) || value.networks.length > 32) return false;
  if (!value.networks.every((network) => typeof network === "string" && network.length > 0 && network.length <= 120 && network === network.trim())) return false;
  if (value.assessment !== undefined && !isNormalizedAssessment(value.assessment)) return false;
  return true;
}
export function isX402DirectorySnapshot(value: unknown): value is X402DirectorySnapshot {
  if (!isRecord(value) || value.version !== 1 || typeof value.fetchedAt !== "string") return false;
  if (!Number.isFinite(Date.parse(value.fetchedAt))) return false;
  if (!Number.isSafeInteger(value.providerTotal) || Number(value.providerTotal) < 0 || Number(value.providerTotal) > MAX_ROWS) return false;
  if (!Array.isArray(value.rows) || value.rows.length > MAX_ROWS) return false;
  return value.rows.every(isNormalizedRow);
}
async function fetchPage(page: number, signal: AbortSignal): Promise<{ rows: X402DirectoryRow[]; total: number }> {
  const params = new URLSearchParams({ page: String(page), per_page: String(PAGE_SIZE) });
  const payload = await fetchPublicJson<DirectoryPage>(`${BASE_URL}?${params}`, {
    signal,
    timeoutMs: 30_000,
    maxResponseBytes: MAX_PAGE_BYTES,
    maxRedirects: 1,
    headers: { Accept: "application/json", "User-Agent": "AgentRanking-x402Indexer/2.0" },
  });
  const rawRows = Array.isArray(payload.data) ? payload.data : [];
  const rows = rawRows.map(normalizeRow).filter((row): row is X402DirectoryRow => row !== null);
  const totalRaw = payload.meta?.total;
  const total = typeof totalRaw === "number" && Number.isFinite(totalRaw)
    ? Math.max(rows.length, Math.trunc(totalRaw))
    : rows.length;
  return { rows, total };
}
export async function refreshX402DirectorySnapshot(): Promise<X402DirectorySnapshot> {
  const signal = AbortSignal.timeout(JOB_TIMEOUT_MS);
  const first = await fetchPage(1, signal);
  const pageCount = Math.min(MAX_PAGES, Math.max(1, Math.ceil(first.total / PAGE_SIZE)));
  const pageNumbers = Array.from({ length: pageCount - 1 }, (_, index) => index + 2);
  const remaining = await mapWithConcurrency(pageNumbers, PAGE_CONCURRENCY, (page) => fetchPage(page, signal));
  const bySlug = new Map<string, X402DirectoryRow>();
  for (const row of [first, ...remaining].flatMap((page) => page.rows)) {
    if (!bySlug.has(row.slug)) bySlug.set(row.slug, row);
    if (bySlug.size >= MAX_ROWS) break;
  }
  const snapshot: X402DirectorySnapshot = {
    version: 1,
    fetchedAt: new Date().toISOString(),
    rows: [...bySlug.values()],
    providerTotal: Math.min(MAX_ROWS, first.total),
  };
  await writeExternalProviderCache({
    key: CACHE_KEY,
    value: snapshot,
    validate: isX402DirectorySnapshot,
    freshTtlSeconds: FRESH_SECONDS,
    staleTtlSeconds: STALE_SECONDS,
    maxPayloadBytes: MAX_SNAPSHOT_BYTES,
  });
  return snapshot;
}
export function loadX402DirectorySnapshot(): Promise<ExternalProviderCacheRead<X402DirectorySnapshot> | null> {
  return readExternalProviderCache({
    key: CACHE_KEY,
    validate: isX402DirectorySnapshot,
    freshTtlSeconds: FRESH_SECONDS,
    staleTtlSeconds: STALE_SECONDS,
    maxPayloadBytes: MAX_SNAPSHOT_BYTES,
  });
}
