import { createHash } from "node:crypto";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import { resolveCovenantAuditBaseUrlFallbacks } from "@/lib/covenant/config";
import { isValidRootHashHex, normalizeRootHashHex } from "@/lib/covenant/ledger";
import { requestPublicHttp, validatePublicHttpUrl } from "@/lib/outbound-http";
const FETCH_MS = 12_000;
export function resolveAuditBaseUrlFromAgentUri(agentUri: string): string | null {
  const trimmed = agentUri.trim();
  if (!trimmed) return null;
  try {
    const validated = validatePublicHttpUrl(trimmed);
    if (!validated.ok) return null;
    const u = validated.url;
    if (u.pathname.includes("/.well-known/")) {
      return `${u.origin}${u.pathname.replace(/\/\.well-known\/[^/]*$/, "")}`;
    }
    return u.origin + u.pathname.replace(/\/?$/, "");
  } catch {
    return null;
  }
}
/** Ordered audit material bases: agentUri-derived first, then env fallbacks. */
export function collectCovenantAuditBaseUrls(agentUri: string | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (base: string | null) => {
    if (!base) return;
    const norm = base.replace(/\/$/, "");
    if (!norm || seen.has(norm)) return;
    seen.add(norm);
    out.push(norm);
  };
  if (agentUri?.trim()) {
    add(resolveAuditBaseUrlFromAgentUri(agentUri));
  }
  for (const fallback of resolveCovenantAuditBaseUrlFallbacks()) {
    add(fallback);
  }
  return out;
}
async function fetchText(url: string): Promise<string | null> {
  try {
    const maxBytes = Math.min(
      8_388_608,
      Math.max(65_536, Number.parseInt(process.env.COVENANT_AUDIT_MAX_BYTES ?? "4194304", 10) || 4_194_304),
    );
    const res = await requestPublicHttp(url, {
      method: "GET",
      timeoutMs: FETCH_MS,
      maxResponseBytes: maxBytes,
      maxRedirects: 3,
      headers: { Accept: "application/json, text/plain, */*" },
    });
    if (res.status < 200 || res.status >= 300 || res.truncated) return null;
    return res.body;
  } catch {
    return null;
  }
}
async function updateHashWithText(
  hash: ReturnType<typeof createHash>,
  text: string,
): Promise<void> {
  const chunkChars = 64 * 1024;
  let processedSinceYield = 0;
  for (let offset = 0; offset < text.length; offset += chunkChars) {
    const chunk = text.slice(offset, offset + chunkChars);
    hash.update(chunk);
    processedSinceYield += chunk.length;
    if (processedSinceYield >= 256 * 1024) {
      processedSinceYield = 0;
      await yieldToEventLoop();
    }
  }
}

export async function recomputeCovenantAuditRootFromTexts(
  eventsText: string,
  chainText: string,
): Promise<string> {
  let prev = Buffer.alloc(32, 0);
  let nonEmptyLines = 0;
  let cursor = 0;
  let processedSinceYield = 0;
  while (cursor <= chainText.length) {
    const newline = chainText.indexOf("\n", cursor);
    const end = newline === -1 ? chainText.length : newline;
    const line = chainText.slice(cursor, end).trim();
    cursor = newline === -1 ? chainText.length + 1 : newline + 1;
    if (!line) continue;
    nonEmptyLines += 1;
    if (/^[0-9a-fA-F]{64}$/.test(line)) {
      prev = Buffer.from(line, "hex");
    } else {
      const hash = createHash("sha256");
      hash.update(prev);
      await updateHashWithText(hash, line);
      prev = hash.digest();
    }
    processedSinceYield += line.length;
    if (processedSinceYield >= 256 * 1024) {
      processedSinceYield = 0;
      await yieldToEventLoop();
    }
  }
  if (nonEmptyLines === 0) {
    const hash = createHash("sha256");
    await updateHashWithText(hash, eventsText);
    prev = hash.digest();
  }
  return normalizeRootHashHex(prev.toString("hex"));
}
async function tryRecomputeAtBase(
  base: string,
  expectedRootHex: string,
): Promise<{ ok: boolean; error?: string; eventsUrl: string; chainUrl: string }> {
  const eventsUrl = `${base}/audit/events.jsonl`;
  const chainUrl = `${base}/audit/events.chain.jsonl`;
  const [eventsText, chainText] = await Promise.all([
    fetchText(eventsUrl),
    fetchText(chainUrl),
  ]);
  if (!eventsText?.trim()) {
    return { ok: false, error: `events.jsonl not reachable at ${eventsUrl}`, eventsUrl, chainUrl };
  }
  if (!chainText?.trim()) {
    return {
      ok: false,
      error: `events.chain.jsonl not reachable at ${chainUrl}`,
      eventsUrl,
      chainUrl,
    };
  }
  const got = await recomputeCovenantAuditRootFromTexts(eventsText, chainText);
  const want = normalizeRootHashHex(expectedRootHex);
  if (got === want) return { ok: true, eventsUrl, chainUrl };
  return {
    ok: false,
    error: `recomputed root mismatch at ${base}`,
    eventsUrl,
    chainUrl,
  };
}
/**
 * Recompute audit root from events.jsonl + events.chain.jsonl (v0 heuristic).
 * Tries agentUri-derived base, then COVENANT_AUDIT_BASE_URL fallbacks.
 */
export async function recomputeAuditRootFromAgentUri(
  agentUri: string | null | undefined,
  expectedRootHex: string,
): Promise<{ ok: boolean; error?: string; attemptedUrls?: string[] }> {
  if (!isValidRootHashHex(expectedRootHex)) {
    return { ok: false, error: "invalid expected root hash" };
  }
  const bases = collectCovenantAuditBaseUrls(agentUri);
  if (bases.length === 0) {
    return { ok: false, error: agentUri?.trim() ? "invalid agentUri" : "agentUri unset" };
  }
  const attemptedUrls: string[] = [];
  const errors: string[] = [];
  for (const base of bases) {
    const result = await tryRecomputeAtBase(base, expectedRootHex);
    attemptedUrls.push(result.eventsUrl, result.chainUrl);
    if (result.ok) return { ok: true, attemptedUrls };
    if (result.error) errors.push(result.error);
  }
  return {
    ok: false,
    error: errors[errors.length - 1] ?? "audit recompute failed",
    attemptedUrls,
  };
}
