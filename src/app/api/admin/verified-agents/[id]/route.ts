import { NextRequest, NextResponse } from "next/server";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { WORK_READY_STATUSES } from "@/lib/jobs/types";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/admin-auth";
import { sanitizeForPostgres } from "@/lib/utils";
import { computeSocialScore, computeAgentScore } from "@/lib/agent-score";
import {
  ADMIN_TRUST_DIMENSION_KEYS,
  type AdminTrustDimensionKey,
} from "@/lib/admin-trust-dimension-overrides";
import {
  ADMIN_SCORING_LAYER_KEYS,
  type AdminScoringLayerKey,
} from "@/lib/admin-scoring-layer-overrides";
import {
  buildAdminScoringPayload,
  applyScoringLayerOverrides,
  prismaDataFromScoringLayers,
} from "@/lib/admin-scoring-payload";
import {
  applyAdminScoringLayerOverridesSql,
  deleteAllAdminScoringLayerOverrideRows,
  mergedScoringLayerOverridesForAgent,
} from "@/lib/admin-scoring-layer-db";
import { agentScoringInputFromRow, computeAgentScoreLayers } from "@/lib/agent-scoring-layers";
import { persistAgentScoresById } from "@/lib/persist-agent-scores";
import { recomputeOrganicRanksOnly } from "@/lib/compute-ranks-queries";
import { CHAIN_SYNC_PRESERVE_METADATA_KEYS_LOWER } from "@/lib/agent-chain-sync-merge";
import { revalidateAgentPublicCache } from "@/lib/revalidate-agent-public-cache";
import {
  invalidateAllPublicStatistics,
  invalidatePublicAgentProfileCaches,
} from "@/lib/invalidate-public-statistics";
import { recomputeBoostsAndListingPowerForAgent } from "@/lib/recompute-single-agent-power-score";
import {
  normalizePublicReferralCodeInput,
  validatePublicReferralCode,
  validatePublicReferralDestination,
  validatePublicReferralInfo,
  expandPublicReferralCodeIfPastedUrl,
} from "@/lib/agent-public-referral";
import {
  mergePublicReferralScalarsIntoRecord,
  loadAgentPublicReferralScalars,
} from "@/lib/agent-public-referral-db";
import { applyAdminTrustDimensionOverridesSql, deleteAllAdminTrustDimensionOverrideRows } from "@/lib/admin-trust-dimension-db";
import { normalizedAgentServiceData } from "@/lib/agent-service-normalization";
import { agentPublicPath } from "@/lib/agent-public-url";
import { deleteCustomListedAgent } from "@/lib/delete-agent-records";
export const dynamic = "force-dynamic";
function normalizeScoringLayerOverridesPatch(
  raw: unknown,
):
  | { ok: true; patch: Partial<Record<AdminScoringLayerKey, number | null>> }
  | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, patch: {} };
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "scoringLayerOverrides must be an object" };
  }
  const o = raw as Record<string, unknown>;
  const patch: Partial<Record<AdminScoringLayerKey, number | null>> = {};
  for (const k of ADMIN_SCORING_LAYER_KEYS) {
    if (!(k in o)) continue;
    const v = o[k];
    if (v === null) {
      patch[k] = null;
      continue;
    }
    const n =
      typeof v === "number" && Number.isFinite(v)
        ? v
        : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))
          ? Number(v)
          : NaN;
    if (!Number.isFinite(n)) {
      return { ok: false, error: `Invalid layer value for "${k}"` };
    }
    patch[k] = clampInt(Math.round(n), 0, 100);
  }
  return { ok: true, patch };
}
/** BigInt in Prisma Json / rare fields breaks `NextResponse.json` — stringify explicitly. */
function adminAgentPayloadResponse(data: unknown, status = 200) {
  try {
    const body = JSON.stringify(data, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    );
    return new NextResponse(body, {
      status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("adminAgentPayloadResponse serialize error:", e);
    return NextResponse.json(
      {
        error: "Failed to serialize response",
        detail: Error.isError(e) ? e.message : String(e),
      },
      { status: 500 },
    );
  }
}
async function loadReferralScalars(agentDbId: number) {
  return loadAgentPublicReferralScalars(prisma, agentDbId);
}
const MAX_NAME = 80;
const MAX_DESC = 2000;
const MAX_URL = 2048;
const MAX_EP = 2048;
const MAX_SVC_VERSION = 64;
const MAX_SERVICES = 24;
const ETH_ADDR = /^0x[a-fA-F0-9]{40}$/;
const ADMIN_POWER_ADJUST_ABS_MAX = 500_000;
/** When set via confirmed score edits — AR survives profile Save until lifted */
const ADMIN_AGENT_RANK_SCORE_LOCK_KEY = "admin_agent_rank_score_lock";
const PUBLIC_REFERRAL_SCALAR_KEYS = new Set([
  "publicReferralCode",
  "publicReferralDestination",
  "publicReferralInfo",
]);
type AgentReferralDbRow = {
  chainId: number;
  agentId: number;
  name: string;
  public_referral_destination: string;
  public_referral_info: string;
};
/** Raw SQL so a stale Prisma Client DMMF cannot block referral reads/writes. */
async function loadAgentReferralRowForAdmin(id: number): Promise<AgentReferralDbRow | null> {
  const rows = await prisma.$queryRaw<AgentReferralDbRow[]>`
    SELECT "chainId", "agentId", "name", "public_referral_destination", "public_referral_info"
    FROM "Agent"
    WHERE id = ${id}
    LIMIT 1
  `;
  return rows[0] ?? null;
}
type SqlExec = Pick<PrismaClient, "$executeRaw">;
async function applyAdminReferralSql(
  exec: SqlExec,
  id: number,
  resolved:
    | {
        patchCode: true;
        publicReferralCode: string | null;
        destination: string;
        info: string;
      }
    | { patchCode: false; destination: string; info: string },
): Promise<void> {
  if (resolved.patchCode) {
    await exec.$executeRaw`
      UPDATE "Agent"
      SET
        "public_referral_code" = ${resolved.publicReferralCode},
        "public_referral_destination" = ${resolved.destination},
        "public_referral_info" = ${resolved.info}
      WHERE id = ${id}
    `;
  } else {
    await exec.$executeRaw`
      UPDATE "Agent"
      SET
        "public_referral_destination" = ${resolved.destination},
        "public_referral_info" = ${resolved.info}
      WHERE id = ${id}
    `;
  }
}
function isUniqueViolation(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (e.code === "P2002") return true;
  if (e.code === "P2010") {
    const m = `${e.message}${JSON.stringify(e.meta ?? {})}`;
    return m.includes("23505") || m.toLowerCase().includes("unique");
  }
  return false;
}
function referralBodyString(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  return typeof raw === "string" ? raw : String(raw);
}
type ReferralRowSlice = {
  publicReferralDestination: string;
  publicReferralInfo: string;
};
/** When `publicReferralCode` is omitted from the body, we do not read or write that column (stale Prisma clients). */
function resolveReferralPatch(
  body: Record<string, unknown>,
  curRow: ReferralRowSlice,
):
  | {
      ok: true;
      destination: string;
      info: string;
      patchCode: true;
      publicReferralCode: string | null;
    }
  | { ok: true; destination: string; info: string; patchCode: false }
  | { ok: false; error: string } {
  const nextInfoRaw =
    body.publicReferralInfo !== undefined ? referralBodyString(body.publicReferralInfo) : curRow.publicReferralInfo;
  const infoCheck = validatePublicReferralInfo(nextInfoRaw);
  if (!infoCheck.ok) return { ok: false, error: infoCheck.error };
  const nextDestRaw =
    body.publicReferralDestination !== undefined
      ? referralBodyString(body.publicReferralDestination)
      : curRow.publicReferralDestination;
  if (body.publicReferralCode !== undefined) {
    const exp = expandPublicReferralCodeIfPastedUrl(body.publicReferralCode, nextDestRaw.trim());
    const effectiveDest = exp.destinationIfInjected ?? nextDestRaw;
    const destCheck = validatePublicReferralDestination(effectiveDest);
    if (!destCheck.ok) return { ok: false, error: destCheck.error };
    const cc = validatePublicReferralCode(normalizePublicReferralCodeInput(exp.code));
    if (!cc.ok) return { ok: false, error: cc.error };
    return {
      ok: true,
      destination: destCheck.value,
      info: infoCheck.value,
      patchCode: true,
      publicReferralCode: cc.code,
    };
  }
  const destCheck = validatePublicReferralDestination(nextDestRaw);
  if (!destCheck.ok) return { ok: false, error: destCheck.error };
  return {
    ok: true,
    destination: destCheck.value,
    info: infoCheck.value,
    patchCode: false,
  };
}
function parseId(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function clampFloat(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
function clampInt(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}
const TRUST_DIM_KEYS = ADMIN_TRUST_DIMENSION_KEYS;
type TrustDimPatchKey = AdminTrustDimensionKey;
function normalizeTrustDimensionOverridesPatch(
  raw: unknown,
):
  | { ok: true; patch: Partial<Record<TrustDimPatchKey, number | null>> }
  | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, patch: {} };
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "trustDimensionOverrides must be an object" };
  }
  const o = raw as Record<string, unknown>;
  const patch: Partial<Record<TrustDimPatchKey, number | null>> = {};
  for (const k of TRUST_DIM_KEYS) {
    if (!(k in o)) continue;
    const v = o[k];
    if (v === null) {
      patch[k] = null;
      continue;
    }
    const n =
      typeof v === "number" && Number.isFinite(v)
        ? v
        : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))
          ? Number(v)
          : NaN;
    if (!Number.isFinite(n)) {
      return { ok: false, error: `Invalid trust dimension value for "${k}"` };
    }
    patch[k] = clampInt(Math.round(n), 0, 100);
  }
  return { ok: true, patch };
}
function isAllowlistedSocialKey(k: string): boolean {
  return CHAIN_SYNC_PRESERVE_METADATA_KEYS_LOWER.has(k.trim().toLowerCase());
}
/**
 * GET /api/admin/verified-agents/[id] — full row for edit form + computed trust / social detection
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const id = parseId((await params).id);
  if (!id) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  try {
    const agent = await prisma.agent.findUnique({
      where: { id },
      include: {
        chain: { select: { chainId: true, name: true, shortName: true } },
        metadata: { select: { id: true, key: true, value: true }, take: 300 },
        services: { select: { id: true, name: true, endpoint: true, version: true } },
      },
    });
    if (!agent) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const { computedAgentRankScore, scoringLayerBreakdown } = await buildAdminScoringPayload(
      prisma,
      id,
      agent,
    );
    const socialPresence = computeSocialScore(agent.metadata ?? [], agent.services ?? []);
    const referralScalars = await loadReferralScalars(id);
    return adminAgentPayloadResponse({
      agent: {
        ...mergePublicReferralScalarsIntoRecord(agent, referralScalars),
        profilePath: agentPublicPath(agent),
      },
      computedAgentRankScore,
      scoringLayerBreakdown,
      socialPresence: {
        score: socialPresence.score,
        twitter: socialPresence.twitter,
        website: socialPresence.website,
        github: socialPresence.github,
        discord: socialPresence.discord,
        telegram: socialPresence.telegram,
      },
    });
  } catch (err) {
    console.error("GET /api/admin/verified-agents/[id] error:", err);
    const detail =
      process.env.NODE_ENV === "development" && Error.isError(err) ? err.message : undefined;
    return NextResponse.json(
      { error: "Failed to load agent", ...(detail ? { detail } : {}) },
      { status: 500 },
    );
  }
}
type ServiceInput = { name?: unknown; endpoint?: unknown; version?: unknown };
function normalizeServicesInput(raw: unknown): { name: string; endpoint: string; version: string }[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length > MAX_SERVICES) return null;
  const out: { name: string; endpoint: string; version: string }[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") return null;
    const o = row as ServiceInput;
    const name = typeof o.name === "string" ? o.name.trim().toUpperCase() : "";
    const endpoint = typeof o.endpoint === "string" ? o.endpoint.trim().slice(0, MAX_EP) : "";
    const version =
      typeof o.version === "string" ? o.version.trim().slice(0, MAX_SVC_VERSION) : "";
    if (!name || name.length > 32) return null;
    out.push({
      name: sanitizeForPostgres(name),
      endpoint: sanitizeForPostgres(endpoint),
      version: sanitizeForPostgres(version),
    });
  }
  return out;
}
/**
 * PATCH /api/admin/verified-agents/[id]
 * Allowlisted scalar fields (never agentId / chainId), optional services, social metadata, scores.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const id = parseId((await params).id);
  if (!id) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  try {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    /** Referral-only PATCH: never run score recompute or serialize large agent JSON (avoids 500s). */
    const REFERRAL_PATCH_KEYS = new Set([
      "publicReferralCode",
      "publicReferralDestination",
      "publicReferralInfo",
    ]);
    const bodyKeys = Object.keys(body);
    const isReferralOnlyRequest =
      bodyKeys.length > 0 &&
      bodyKeys.every((k) => REFERRAL_PATCH_KEYS.has(k)) &&
      (body.publicReferralCode !== undefined ||
        body.publicReferralDestination !== undefined ||
        body.publicReferralInfo !== undefined);
    if (isReferralOnlyRequest) {
      const dbRow = await loadAgentReferralRowForAdmin(id);
      if (!dbRow) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      const curRow: ReferralRowSlice = {
        publicReferralDestination: dbRow.public_referral_destination ?? "",
        publicReferralInfo: dbRow.public_referral_info ?? "",
      };
      const resolved = resolveReferralPatch(body, curRow);
      if (!resolved.ok) {
        return NextResponse.json({ error: resolved.error }, { status: 400 });
      }
      try {
        await applyAdminReferralSql(prisma, id, resolved);
      } catch (e) {
        if (isUniqueViolation(e)) {
          return NextResponse.json({ error: "That referral code is already taken." }, { status: 400 });
        }
        throw e;
      }
      await revalidateAgentPublicCache(dbRow.chainId, dbRow.agentId, dbRow.name);
      return NextResponse.json({ ok: true });
    }
    const resumeAutoArScore = body.resumeAutoArScore === true;
    const recomputeListingPower = body.recomputeListingPower === true;
    const trustDimNormalize = normalizeTrustDimensionOverridesPatch(body.trustDimensionOverrides);
    if (!trustDimNormalize.ok) {
      return NextResponse.json({ error: trustDimNormalize.error }, { status: 400 });
    }
    const trustDimPatch = trustDimNormalize.patch;
    const hasTrustDimensionOverridesPatch = Object.keys(trustDimPatch).length > 0;
    const layerNormalize = normalizeScoringLayerOverridesPatch(body.scoringLayerOverrides);
    if (!layerNormalize.ok) {
      return NextResponse.json({ error: layerNormalize.error }, { status: 400 });
    }
    const layerPatch = layerNormalize.patch;
    const hasScoringLayerOverridesPatch = Object.keys(layerPatch).length > 0;
    if (resumeAutoArScore) {
      await prisma.agentMetadata.deleteMany({
        where: { agentId: id, key: ADMIN_AGENT_RANK_SCORE_LOCK_KEY },
      });
      await deleteAllAdminTrustDimensionOverrideRows(prisma, id);
      await deleteAllAdminScoringLayerOverrideRows(prisma, id);
    }
    const previousRouteName = typeof body.name === "string"
      ? (await prisma.agent.findUnique({
          where: { id },
          select: { name: true },
        }))?.name ?? null
      : null;
    const data: Prisma.AgentUpdateInput = {};
    if (typeof body.name === "string") {
      data.name = sanitizeForPostgres(body.name.trim().slice(0, MAX_NAME));
    }
    if (typeof body.description === "string") {
      data.description = sanitizeForPostgres(body.description.trim().slice(0, MAX_DESC));
    }
    if (typeof body.image === "string") {
      data.image = sanitizeForPostgres(body.image.trim().slice(0, MAX_URL));
    }
    if (typeof body.agentURI === "string") {
      data.agentURI = sanitizeForPostgres(body.agentURI.trim().slice(0, MAX_URL));
    }
    if (typeof body.owner === "string") {
      const o = body.owner.trim().toLowerCase();
      if (o === "") {
        data.owner = "";
      } else if (ETH_ADDR.test(o)) {
        data.owner = sanitizeForPostgres(o);
      }
    }
    if (typeof body.tokenAddress === "string") {
      data.tokenAddress = sanitizeForPostgres(body.tokenAddress.trim().toLowerCase().slice(0, 100));
    }
    if (typeof body.isVerified === "boolean") {
      data.isVerified = body.isVerified;
    }
    if (typeof body.isPremiumVerified === "boolean") {
      data.isPremiumVerified = body.isPremiumVerified;
    }
    if (typeof body.isActive === "boolean") {
      data.administrativeActiveOverride = body.isActive;
      if (!body.isActive) {
        data.publiclyActive = false;
        data.isActive = false;
      } else {
        const activation = await prisma.agent.findUnique({
          where: { id },
          select: { sourceActive: true, moderationStatus: true, registrationStatus: true, isCustomListed: true },
        });
        if (!activation) return NextResponse.json({ error: "Not found" }, { status: 404 });
        const sourceAllows = activation.sourceActive !== false;
        const moderationAllows = activation.moderationStatus !== "blocked" && activation.moderationStatus !== "disabled";
        const complete = activation.registrationStatus === "valid" || activation.registrationStatus === "available" || activation.isCustomListed;
        const publicActive = sourceAllows && moderationAllows && complete;
        data.publiclyActive = publicActive;
        data.isActive = publicActive;
      }
    }
    if (typeof body.isCustomListed === "boolean") {
      data.isCustomListed = body.isCustomListed;
    }
    let workReadyTouched = false;
    if (typeof body.workReadyStatus === "string") {
      const status = body.workReadyStatus.trim().toLowerCase();
      if (!WORK_READY_STATUSES.includes(status as (typeof WORK_READY_STATUSES)[number])) {
        return NextResponse.json({ error: "Invalid workReadyStatus" }, { status: 400 });
      }
      data.workReadyStatus = status;
      workReadyTouched = true;
    }
    if (typeof body.featuredWorkReady === "boolean") {
      data.featuredWorkReady = body.featuredWorkReady;
      workReadyTouched = true;
    }
    if (body.workReadyReasons !== undefined) {
      if (!Array.isArray(body.workReadyReasons)) {
        return NextResponse.json({ error: "workReadyReasons must be an array" }, { status: 400 });
      }
      data.workReadyReasons = body.workReadyReasons
        .map((r) => (typeof r === "string" ? sanitizeForPostgres(r.trim().slice(0, 120)) : ""))
        .filter(Boolean);
      workReadyTouched = true;
    }
    if (workReadyTouched) {
      data.workReadyUpdatedAt = new Date();
    }
    const n = (v: unknown): number | null =>
      typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null;
    const maybeScore = n(body.score);
    if (maybeScore != null) data.score = clampFloat(maybeScore, 0, 100);
    const maybeHot = n(body.hotScore);
    if (maybeHot != null) data.hotScore = clampFloat(maybeHot, 0, 100);
    const maybeRank = n(body.rank);
    if (maybeRank != null) data.rank = clampInt(maybeRank, 0, 99_999_999);
    const applyManualScores = body.applyManualScores === true;
    const maybeAgentRankScore = n(body.agentRankScore);
    /** When omitted on a generic PATCH, AR Score is recalculated; Execution Score may be patched independently. */
    const maybeExecutionScore = n(body.executionScore);
    const maybeListingPower = n(body.powerScore);
    if (applyManualScores) {
      if (maybeAgentRankScore != null) data.agentRankScore = clampInt(maybeAgentRankScore, 0, 100);
      if (maybeExecutionScore != null) data.executionScore = clampInt(maybeExecutionScore, 0, 100);
      if (maybeListingPower != null) {
        data.powerScore = clampFloat(maybeListingPower, 0, 10_000_000);
      }
    } else if (maybeExecutionScore != null) {
      data.executionScore = clampInt(maybeExecutionScore, 0, 100);
    }
    const maybeAdminPow = n(body.adminPowerAdjust);
    if (maybeAdminPow != null) {
      data.adminPowerAdjust = clampInt(maybeAdminPow, -ADMIN_POWER_ADJUST_ABS_MAX, ADMIN_POWER_ADJUST_ABS_MAX);
    }
    const maybeDim = (field: string) => {
      const v = n(body[field]);
      if (v != null) (data as Record<string, number>)[field] = clampFloat(v, 0, 100);
    };
    maybeDim("scoreMetadata");
    maybeDim("scoreServices");
    maybeDim("scoreQuality");
    maybeDim("scorePopularity");
    maybeDim("scoreFreshness");
    maybeDim("scoreWallet");
    const hasBanner = typeof body.banner === "string";
    const servicesNorm = body.services !== undefined ? normalizeServicesInput(body.services) : undefined;
    if (body.services !== undefined && servicesNorm === null) {
      return NextResponse.json({ error: "Invalid services array" }, { status: 400 });
    }
    let socialPatch: Record<string, string> | null = null;
    if (body.socialMetadata !== undefined && body.socialMetadata !== null) {
      if (typeof body.socialMetadata !== "object" || Array.isArray(body.socialMetadata)) {
        return NextResponse.json({ error: "socialMetadata must be an object" }, { status: 400 });
      }
      socialPatch = {};
      for (const [k, v] of Object.entries(body.socialMetadata as Record<string, unknown>)) {
        const kl = k.trim().toLowerCase();
        if (!isAllowlistedSocialKey(kl)) continue;
        if (typeof v !== "string") continue;
        socialPatch[kl] = sanitizeForPostgres(v.trim().slice(0, MAX_URL));
      }
    }
    const hasServices = servicesNorm !== undefined;
    const hasSocial = socialPatch != null && Object.keys(socialPatch).length > 0;
    const referralTouched =
      body.publicReferralCode !== undefined ||
      body.publicReferralDestination !== undefined ||
      body.publicReferralInfo !== undefined;
    let referralSqlPending:
      | {
          patchCode: true;
          publicReferralCode: string | null;
          destination: string;
          info: string;
        }
      | { patchCode: false; destination: string; info: string }
      | null = null;
    let referralRevalidateMeta: { chainId: number; agentId: number; name: string } | null = null;
    if (referralTouched) {
      const dbRow = await loadAgentReferralRowForAdmin(id);
      if (!dbRow) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      const curRow: ReferralRowSlice = {
        publicReferralDestination: dbRow.public_referral_destination ?? "",
        publicReferralInfo: dbRow.public_referral_info ?? "",
      };
      const merged = resolveReferralPatch(body, curRow);
      if (!merged.ok) {
        return NextResponse.json({ error: merged.error }, { status: 400 });
      }
      referralSqlPending = merged;
      referralRevalidateMeta = {
        chainId: dbRow.chainId,
        agentId: dbRow.agentId,
        name: dbRow.name,
      };
    }
    const hasAgentScalar = Object.keys(data).length > 0;
    const onlyReferralSqlSave =
      referralSqlPending != null &&
      !hasAgentScalar &&
      !hasBanner &&
      !hasServices &&
      !hasSocial &&
      !resumeAutoArScore &&
      !recomputeListingPower &&
      !applyManualScores &&
      !hasTrustDimensionOverridesPatch &&
      !hasScoringLayerOverridesPatch;
    const onlyPublicReferralScalars =
      (hasAgentScalar && Object.keys(data).every((k) => PUBLIC_REFERRAL_SCALAR_KEYS.has(k))) ||
      onlyReferralSqlSave;
    const onlyScoringLayerOverridesPatch =
      hasScoringLayerOverridesPatch &&
      !hasTrustDimensionOverridesPatch &&
      !hasAgentScalar &&
      referralSqlPending == null &&
      !hasBanner &&
      !hasServices &&
      !hasSocial &&
      !resumeAutoArScore &&
      !recomputeListingPower &&
      !applyManualScores;
    const onlyTrustDimensionOverridesPatch =
      hasTrustDimensionOverridesPatch &&
      !hasScoringLayerOverridesPatch &&
      !hasAgentScalar &&
      referralSqlPending == null &&
      !hasBanner &&
      !hasServices &&
      !hasSocial &&
      !resumeAutoArScore &&
      !recomputeListingPower &&
      !applyManualScores;
    const skipScoreRecompute =
      !resumeAutoArScore &&
      !recomputeListingPower &&
      !applyManualScores &&
      (onlyScoringLayerOverridesPatch ||
        onlyTrustDimensionOverridesPatch ||
        (onlyPublicReferralScalars && !hasBanner && !hasServices && !hasSocial));
    if (
      !hasAgentScalar &&
      referralSqlPending == null &&
      !hasBanner &&
      !hasServices &&
      !hasSocial &&
      !resumeAutoArScore &&
      !recomputeListingPower &&
      !hasTrustDimensionOverridesPatch &&
      !hasScoringLayerOverridesPatch
    ) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }
    try {
      await prisma.$transaction(async (tx) => {
        if (referralSqlPending) {
          await applyAdminReferralSql(tx, id, referralSqlPending);
        }
        if (hasAgentScalar) {
          await tx.agent.update({ where: { id }, data });
        }
        if (hasBanner) {
          const b = sanitizeForPostgres((body.banner as string).trim().slice(0, MAX_URL));
          if (b === "") {
            await tx.agentMetadata.deleteMany({ where: { agentId: id, key: "banner" } });
          } else {
            const existingBanner = await tx.agentMetadata.findFirst({
              where: { agentId: id, key: "banner" },
            });
            if (existingBanner) {
              await tx.agentMetadata.update({
                where: { id: existingBanner.id },
                data: { value: b },
              });
            } else {
              await tx.agentMetadata.create({
                data: { agentId: id, key: "banner", value: b },
              });
            }
          }
        }
        if (socialPatch) {
          for (const [key, value] of Object.entries(socialPatch)) {
            if (value === "") {
              await tx.agentMetadata.deleteMany({ where: { agentId: id, key } });
            } else {
              const row = await tx.agentMetadata.findFirst({ where: { agentId: id, key } });
              if (row) {
                await tx.agentMetadata.update({ where: { id: row.id }, data: { value } });
              } else {
                await tx.agentMetadata.create({ data: { agentId: id, key, value } });
              }
            }
          }
        }
        if (hasTrustDimensionOverridesPatch) {
          await applyAdminTrustDimensionOverridesSql(tx, id, trustDimPatch);
        }
        if (hasScoringLayerOverridesPatch) {
          await applyAdminScoringLayerOverridesSql(tx, id, layerPatch);
        }
        if (servicesNorm) {
          await tx.agentService.deleteMany({ where: { agentId: id } });
          if (servicesNorm.length > 0) {
            const normalizedServices = servicesNorm.map((service) => normalizedAgentServiceData(service, { sourceKind: "admin" }));
            await tx.agentService.createMany({
              data: normalizedServices.map((service) => ({
                agentId: id,
                ...service,
                extensions: service.extensions as never,
              })),
            });
          }
        }
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        return NextResponse.json({ error: "That referral code is already taken." }, { status: 400 });
      }
      throw e;
    }
    /** Referral-only saves: avoid heavy include + trust serialization (large Json blobs can break responses). */
    if (onlyPublicReferralScalars && skipScoreRecompute) {
      const slim =
        referralRevalidateMeta ??
        (await prisma.agent.findUnique({
          where: { id },
          select: { chainId: true, agentId: true, name: true },
        }));
      if (!slim) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      await revalidateAgentPublicCache(slim.chainId, slim.agentId, slim.name);
      return NextResponse.json({ ok: true });
    }
    /** Layer overrides recompute composite AR (agentRankScore) and clear manual AR pin. */
    if (hasScoringLayerOverridesPatch) {
      const syncAgent = await prisma.agent.findUnique({
        where: { id },
        include: {
          chain: { select: { chainId: true, name: true, shortName: true } },
          metadata: { select: { id: true, key: true, value: true }, take: 300 },
          services: { select: { id: true, name: true, endpoint: true, version: true } },
        },
      });
      if (syncAgent) {
        const layerOv = await mergedScoringLayerOverridesForAgent(prisma, id, syncAgent.metadata);
        const baseLayers = computeAgentScoreLayers(agentScoringInputFromRow(syncAgent));
        const displayLayers = applyScoringLayerOverrides(baseLayers, layerOv);
        await prisma.agent.update({
          where: { id },
          data: prismaDataFromScoringLayers(displayLayers),
        });
        await prisma.agentMetadata.deleteMany({
          where: { agentId: id, key: ADMIN_AGENT_RANK_SCORE_LOCK_KEY },
        });
        await recomputeOrganicRanksOnly(prisma);
      }
    }
    let agent = await prisma.agent.findUnique({
      where: { id },
      include: {
        chain: { select: { chainId: true, name: true, shortName: true } },
        metadata: { select: { id: true, key: true, value: true }, take: 300 },
        services: { select: { id: true, name: true, endpoint: true, version: true } },
      },
    });
    if (!agent) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!skipScoreRecompute) {
      const metaRows = agent.metadata ?? [];
      const serviceRows = agent.services ?? [];
      const scored = computeAgentScore({
        name: agent.name,
        description: agent.description,
        image: agent.image,
        metadata: metaRows,
        services: serviceRows.map((s) => ({ name: s.name, endpoint: s.endpoint })),
        scoreWallet: agent.scoreWallet,
        x402Support: agent.x402Support,
        binanceCompatible: agent.binanceCompatible,
        totalFeedback: agent.totalFeedback,
        scoreQuality: agent.scoreQuality ?? 0,
        lastActiveAt: agent.lastActiveAt,
        isVerifiedRevenue: agent.isVerifiedRevenue,
        perfWinRate: agent.perfWinRate,
        perfMonthlyPnlUsd: agent.perfMonthlyPnlUsd,
        perfBurnToEarnRatio: agent.perfBurnToEarnRatio,
      });
      await prisma.agent.update({
        where: { id },
        data: {
          hotScore: scored.hotScore,
          scoreMetadata: scored.scoreMetadata,
          scoreServices: scored.scoreEndpoints,
          scorePopularity: scored.scorePopularity,
          scoreFreshness: scored.scoreFreshness,
        },
      });
      const manualAgentRankLocked = metaRows.some(
        (m) =>
          m.key === ADMIN_AGENT_RANK_SCORE_LOCK_KEY &&
          typeof m.value === "string" &&
          m.value.trim().toLowerCase() === "1",
      );
      if (applyManualScores && maybeAgentRankScore != null) {
        await prisma.agent.update({
          where: { id },
          data: { agentRankScore: clampInt(maybeAgentRankScore, 0, 100) },
        });
      } else if (!manualAgentRankLocked) {
        await persistAgentScoresById(prisma, id, { includeFinalRank: true });
      }
      await recomputeOrganicRanksOnly(prisma);
      agent =
        (await prisma.agent.findUnique({
          where: { id },
          include: {
            chain: { select: { chainId: true, name: true, shortName: true } },
            metadata: { select: { id: true, key: true, value: true }, take: 300 },
            services: { select: { id: true, name: true, endpoint: true, version: true } },
          },
        })) ?? agent;
    }
    if (applyManualScores && maybeAgentRankScore != null) {
      const row = await prisma.agentMetadata.findFirst({
        where: { agentId: id, key: ADMIN_AGENT_RANK_SCORE_LOCK_KEY },
      });
      if (row) {
        await prisma.agentMetadata.update({
          where: { id: row.id },
          data: { value: "1" },
        });
      } else {
        await prisma.agentMetadata.create({
          data: { agentId: id, key: ADMIN_AGENT_RANK_SCORE_LOCK_KEY, value: "1" },
        });
      }
      await deleteAllAdminTrustDimensionOverrideRows(prisma, id);
      await deleteAllAdminScoringLayerOverrideRows(prisma, id);
      await recomputeOrganicRanksOnly(prisma);
    }
    if (resumeAutoArScore) {
      await persistAgentScoresById(prisma, id, { includeFinalRank: true });
      await recomputeOrganicRanksOnly(prisma);
      agent =
        (await prisma.agent.findUnique({
          where: { id },
          include: {
            chain: { select: { chainId: true, name: true, shortName: true } },
            metadata: { select: { id: true, key: true, value: true }, take: 300 },
            services: { select: { id: true, name: true, endpoint: true, version: true } },
          },
        })) ?? agent;
    }
    if (recomputeListingPower) {
      await recomputeBoostsAndListingPowerForAgent(prisma, id);
      agent =
        (await prisma.agent.findUnique({
          where: { id },
          include: {
            chain: { select: { chainId: true, name: true, shortName: true } },
            metadata: { select: { id: true, key: true, value: true }, take: 300 },
            services: { select: { id: true, name: true, endpoint: true, version: true } },
          },
        })) ?? agent;
    }
    const { computedAgentRankScore, scoringLayerBreakdown } = await buildAdminScoringPayload(
      prisma,
      id,
      agent,
    );
    const socialPresence = computeSocialScore(agent.metadata ?? [], agent.services ?? []);
    const referralScalars = await loadReferralScalars(id);
    const visibilityChanged =
      typeof body.isVerified === "boolean" ||
      typeof body.isPremiumVerified === "boolean" ||
      typeof body.isActive === "boolean" ||
      typeof body.isCustomListed === "boolean";
    if (visibilityChanged) await invalidateAllPublicStatistics();
    else await invalidatePublicAgentProfileCaches();
    await revalidateAgentPublicCache(
      agent.chainId,
      agent.agentId,
      agent.name,
      previousRouteName,
    );
    return adminAgentPayloadResponse({
      ok: true,
      agent: {
        ...mergePublicReferralScalarsIntoRecord(agent, referralScalars),
        profilePath: agentPublicPath(agent),
      },
      computedAgentRankScore,
      scoringLayerBreakdown,
      socialPresence: {
        score: socialPresence.score,
        twitter: socialPresence.twitter,
        website: socialPresence.website,
        github: socialPresence.github,
        discord: socialPresence.discord,
        telegram: socialPresence.telegram,
      },
    });
  } catch (err) {
    console.error("PATCH /api/admin/verified-agents/[id] error:", err);
    const detail = Error.isError(err) ? err.message : String(err);
    return NextResponse.json(
      { error: "Failed to update agent", detail },
      { status: 500 },
    );
  }
}
/**
 * DELETE /api/admin/verified-agents/[id]
 * Default: soft delete (isActive: false).
 * ?hard=1 + JSON { "confirmName": "<exact name>" } — only for isCustomListed agents; removes row and dependents.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const id = parseId((await params).id);
  if (!id) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  try {
    const { searchParams } = new URL(request.url);
    const hard = searchParams.get("hard") === "1" || searchParams.get("hard") === "true";
    const existing = await prisma.agent.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        isCustomListed: true,
      },
    });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!hard) {
      await prisma.agent.update({
        where: { id },
        data: { administrativeActiveOverride: false, publiclyActive: false, isActive: false },
      });
      await invalidateAllPublicStatistics();
      return NextResponse.json({ ok: true, mode: "soft" });
    }
    if (!existing.isCustomListed) {
      return NextResponse.json(
        { error: "Hard delete is only allowed for custom-listed agents" },
        { status: 403 }
      );
    }
    let body: { confirmName?: string } = {};
    try {
      body = (await request.json()) as { confirmName?: string };
    } catch {
      /* empty body */
    }
    if ((body.confirmName ?? "").trim() !== existing.name.trim()) {
      return NextResponse.json(
        { error: "confirmName must match agent name exactly" },
        { status: 400 }
      );
    }
    const deletion = await deleteCustomListedAgent(id);
    if (deletion.status !== "deleted") {
      return NextResponse.json(
        { error: deletion.status === "not_found" ? "Not found" : "Hard delete is only allowed for custom-listed agents" },
        { status: deletion.status === "not_found" ? 404 : 403 },
      );
    }
    await invalidateAllPublicStatistics();
    return NextResponse.json({ ok: true, mode: "hard" });
  } catch (err) {
    console.error("DELETE /api/admin/verified-agents/[id] error:", err);
    return NextResponse.json({ error: "Failed to delete agent" }, { status: 500 });
  }
}
