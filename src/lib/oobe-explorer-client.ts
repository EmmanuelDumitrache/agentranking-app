/**
 * OOBE Protocol Explorer REST API — **server-side only** (Node route handlers/background workers).
 * Avoid calling from browser components: CORS may block; use Route Handlers or RSC fetches instead.
 *
 * Env:
 * - `OOBE_EXPLORER_API_BASE` — default `https://explorer.oobeprotocol.ai`
 * - `OOBE_EXPLORER_API_KEY` — optional `Authorization: Bearer …`
 */
import { z } from "zod";
const DEFAULT_BASE = "https://explorer.oobeprotocol.ai";
export class OobeExplorerHttpError extends Error {
  readonly status: number;
  readonly bodySnippet: string;
  constructor(status: number, bodySnippet: string) {
    super(`OOBE Explorer HTTP ${status}: ${bodySnippet.slice(0, 200)}`);
    this.name = "OobeExplorerHttpError";
    this.status = status;
    this.bodySnippet = bodySnippet;
  }
}
export function getOobeExplorerApiBase(): string {
  const raw = (process.env.OOBE_EXPLORER_API_BASE ?? DEFAULT_BASE).trim();
  return raw.replace(/\/$/, "");
}
function buildDefaultHeaders(): HeadersInit {
  const h: Record<string, string> = { Accept: "application/json" };
  const key = process.env.OOBE_EXPLORER_API_KEY?.trim();
  if (key) h.Authorization = `Bearer ${key}`;
  return h;
}
function toSearchParams(q: Record<string, string | number | boolean | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined) continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}
/** Low-level GET; returns parsed JSON or throws. */
export async function oobeExplorerGet(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
  const base = getOobeExplorerApiBase();
  const pathNorm = path.startsWith("/") ? path : `/${path}`;
  const qs = query ? toSearchParams(query) : "";
  const url = `${base}/api/v1${pathNorm}${qs}`;
  const res = await fetch(url, {
    headers: buildDefaultHeaders(),
    next: { revalidate: 0 },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new OobeExplorerHttpError(res.status, text);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`OOBE Explorer: non-JSON response from ${pathNorm}`);
  }
}
const envelopeSchema = z.object({
  data: z.unknown(),
  meta: z.record(z.string(), z.unknown()).optional(),
});
export function parseOobeExplorerEnvelope(json: unknown): { data: unknown; meta?: Record<string, unknown> } {
  const p = envelopeSchema.safeParse(json);
  if (!p.success) throw new Error(`OOBE Explorer: invalid envelope — ${p.error.message}`);
  return { data: p.data.data, meta: p.data.meta };
}
/* ---- Status ---- */
const statusDataSchema = z
  .object({
    status: z.string(),
    version: z.string().optional(),
    timestamp: z.string().optional(),
    components: z
      .object({
        indexer: z
          .object({
            status: z.string().optional(),
            cursors: z
              .array(
                z.object({
                  entity: z.string(),
                  lastSyncAgoSec: z.number().optional(),
                  stale: z.boolean().optional(),
                  maxAgeSec: z.number().optional(),
                }),
              )
              .optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type OobeExplorerStatusData = z.infer<typeof statusDataSchema>;
export async function getOobeExplorerStatus(): Promise<{ data: OobeExplorerStatusData; meta?: Record<string, unknown> }> {
  const raw = await oobeExplorerGet("/status");
  const { data, meta } = parseOobeExplorerEnvelope(raw);
  const p = statusDataSchema.safeParse(data);
  if (!p.success) throw new Error(`OOBE Explorer status: ${p.error.message}`);
  return { data: p.data, meta };
}
/** Whether the agents indexer cursor is stale per Explorer status payload. */
export function oobeAgentsCursorStale(status: OobeExplorerStatusData): boolean {
  const cursors = status.components?.indexer?.cursors;
  if (!cursors) return false;
  const agents = cursors.find((c) => c.entity === "agents");
  return agents?.stale === true;
}
/* ---- Agents ---- */
const agentRowSchema = z
  .object({
    pda: z.string(),
  })
  .passthrough();
export type OobeExplorerAgentRow = z.infer<typeof agentRowSchema>;
function parseOobeExplorerAgentRows(data: unknown): OobeExplorerAgentRow[] {
  if (!Array.isArray(data)) return [];
  const out: OobeExplorerAgentRow[] = [];
  for (const item of data) {
    const p = agentRowSchema.safeParse(item);
    if (p.success) out.push(p.data);
  }
  return out;
}
function oobeExplorerHasMore(meta: Record<string, unknown> | undefined, batchSize: number): boolean {
  if (!meta) return false;
  if (meta.hasMore === true) return true;
  const total = typeof meta.total === "number" ? meta.total : Number(meta.total);
  const limit = typeof meta.limit === "number" ? meta.limit : Number(meta.limit);
  if (Number.isFinite(total) && Number.isFinite(limit) && limit > 0) {
    const offset = typeof meta.offset === "number" ? meta.offset : Number(meta.offset ?? 0);
    if (Number.isFinite(offset)) return offset + batchSize < total;
  }
  return false;
}
/** Paginates OOBE Explorer `GET /api/v1/agents` (API caps page size; default 200). */
export async function listOobeExplorerAgents(options?: {
  limit?: number;
  pageSize?: number;
}): Promise<OobeExplorerAgentRow[]> {
  const maxTotal = Math.min(Math.max(options?.limit ?? 10_000, 1), 10_000);
  const pageSize = Math.min(Math.max(options?.pageSize ?? 200, 1), 500);
  const out: OobeExplorerAgentRow[] = [];
  let offset = 0;
  while (out.length < maxTotal) {
    const raw = await oobeExplorerGet("/agents", { limit: pageSize, offset });
    const { data, meta } = parseOobeExplorerEnvelope(raw);
    const batch = parseOobeExplorerAgentRows(data);
    if (batch.length === 0) break;
    out.push(...batch);
    if (!oobeExplorerHasMore(meta, batch.length) || batch.length < pageSize) break;
    offset += batch.length;
  }
  return out.slice(0, maxTotal);
}
/* ---- Network ---- */
export async function getOobeNetworkMetrics(): Promise<unknown> {
  const raw = await oobeExplorerGet("/network/metrics");
  return parseOobeExplorerEnvelope(raw).data;
}
/* ---- Analytics ---- */
export async function getOobeEscrowAlerts(): Promise<unknown> {
  const raw = await oobeExplorerGet("/escrows/alerts");
  return parseOobeExplorerEnvelope(raw).data;
}
export async function getOobeVolume(): Promise<unknown> {
  const raw = await oobeExplorerGet("/volume");
  return parseOobeExplorerEnvelope(raw).data;
}
export async function getOobeVolumeDaily(options?: { days?: number }): Promise<unknown> {
  const raw = await oobeExplorerGet("/volume/daily", { days: options?.days ?? 14 });
  return parseOobeExplorerEnvelope(raw).data;
}