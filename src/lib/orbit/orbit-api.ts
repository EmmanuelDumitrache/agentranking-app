import type { NextRequest } from "next/server";
import { getOrbitSkills } from "@/lib/orbit/orbit-skill-taxonomy";
export const ORBIT_CURATED_MCP_VERSION = "orbit_curated_mcp_v0";
export type OrbitApiOptions = {
  limit: number;
  mcpOnly: boolean;
  verifiedOnly: boolean;
  category?: string;
};
export type OrbitAuthResult =
  | { ok: true }
  | { ok: false; status: number; body: { error: string } };
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
export function parseOrbitBooleanParam(value: string | null): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "y"].includes(value.trim().toLowerCase());
}
export function parseOrbitLimitParam(value: string | null): number {
  if (!value) return DEFAULT_LIMIT;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, parsed));
}
export function parseOrbitApiOptions(searchParams: URLSearchParams): OrbitApiOptions {
  const category = searchParams.get("category")?.trim().toLowerCase() || undefined;
  return {
    limit: parseOrbitLimitParam(searchParams.get("limit")),
    mcpOnly: parseOrbitBooleanParam(searchParams.get("mcpOnly")),
    verifiedOnly: parseOrbitBooleanParam(searchParams.get("verifiedOnly")),
    category,
  };
}
function isLocalRequest(request: NextRequest): boolean {
  const host = request.headers.get("host")?.toLowerCase() ?? "";
  return host.startsWith("localhost") || host.startsWith("127.0.0.1") || host.includes(".localhost");
}
export function getOrbitPartnerApiKey(): string | undefined {
  return process.env.ORBIT_PARTNER_API_KEY?.trim() || undefined;
}
export function authorizeOrbitPartnerRequest(request: NextRequest): OrbitAuthResult {
  const configuredKey = getOrbitPartnerApiKey();
  if (!configuredKey) {
    if (process.env.NODE_ENV !== "production" || isLocalRequest(request)) return { ok: true };
    return {
      ok: false,
      status: 503,
      body: { error: "ORBIT_PARTNER_API_KEY is not configured." },
    };
  }
  const providedKey = request.headers.get("x-api-key")?.trim();
  if (providedKey === configuredKey) return { ok: true };
  return {
    ok: false,
    status: 401,
    body: { error: "Invalid or missing Orbit partner API key." },
  };
}
/** Stricter auth for launch ingestion — always requires a matching x-api-key when configured. */
export function authorizeOrbitPartnerIngestRequest(request: NextRequest): OrbitAuthResult {
  const configuredKey = getOrbitPartnerApiKey();
  if (!configuredKey) {
    if (process.env.NODE_ENV !== "production" && isLocalRequest(request)) return { ok: true };
    return {
      ok: false,
      status: 503,
      body: { error: "ORBIT_PARTNER_API_KEY is not configured." },
    };
  }
  const providedKey = request.headers.get("x-api-key")?.trim();
  if (!providedKey || providedKey !== configuredKey) {
    return {
      ok: false,
      status: 401,
      body: { error: "Invalid or missing Orbit partner API key." },
    };
  }
  return { ok: true };
}
export function buildOrbitUnknownSkillPayload(skillId: string) {
  return {
    error: "Unknown Orbit skill.",
    skillId,
    availableSkills: getOrbitSkills().map((skill) => skill.id),
  };
}
