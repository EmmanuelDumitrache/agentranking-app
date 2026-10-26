import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/admin-auth";
import {
  AR_TOKEN_EVENT_TYPES,
  AR_TOKEN_SETTING_ID,
  DEFAULT_AR_TOKEN_PERK_CONFIGS,
  isArTokenEventType,
  normalizeArTokenSettings,
} from "@/lib/ar-token-metrics";
import { validateMetricEventInput } from "@/lib/ar-token-metric-event-validate";
import { readArTokenMetricsPayload } from "@/lib/ar-token-admin-data";
import { readAdminArTokenMetrics } from "@/lib/admin/operations/ar-token.server";
import { isAdminOperationsUnauthorized } from "@/lib/admin/operations/auth.server";
import { getStakeSiteUrl } from "@/lib/site-url";
export const dynamic = "force-dynamic";
const MAX_TEXT = 500;
function asTrimmedString(value: unknown, max = MAX_TEXT): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
function parseChainId(value: unknown): number {
  const raw = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value.trim(), 10) : Number.NaN;
  if (!Number.isFinite(raw) || raw < 0) return 0;
  return Math.min(raw, 2_147_483_647);
}
function parseTokenDecimals(value: unknown): number {
  const raw = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value.trim(), 10) : Number.NaN;
  if (!Number.isFinite(raw)) return 18;
  return Math.min(36, Math.max(0, Math.floor(raw)));
}
function parseTokenLedger(value: unknown): string {
  const s = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (s === "solana") return "solana";
  return "evm";
}
function parseSolanaCluster(value: unknown): string {
  const s = typeof value === "string" ? value.trim().toLowerCase() : "";
  const allowed = new Set(["mainnet-beta", "devnet", "testnet"]);
  if (allowed.has(s)) return s;
  return "mainnet-beta";
}
function parseOccurredAt(value: unknown): Date {
  if (typeof value !== "string" || value.trim() === "") return new Date();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}
function parseIntClamped(value: unknown, fallback = 0, min = -1_000_000, max = 1_000_000): number {
  const raw = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value.trim(), 10) : Number.NaN;
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(raw)));
}
function parsePerkStatus(value: unknown): string {
  const s = asTrimmedString(value, 40);
  if (s === "coming_soon" || s === "hidden") return s;
  return "active";
}
function parseBalanceRaw(value: unknown): string {
  const s = asTrimmedString(value, 80).replaceAll(",", "");
  return /^\d+$/.test(s) ? s : "0";
}
function parseRecipients(value: unknown): Array<{ wallet: string; amount: string; note?: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item !== "object" || item == null) return null;
      const row = item as { wallet?: unknown; amount?: unknown; note?: unknown };
      const wallet = asTrimmedString(row.wallet, 140);
      const amount = asTrimmedString(row.amount, 80);
      if (!wallet || !amount) return null;
      const note = asTrimmedString(row.note, 200);
      return note ? { wallet, amount, note } : { wallet, amount };
    })
    .filter((item): item is { wallet: string; amount: string; note?: string } => item !== null);
}
function totalAmount(recipients: Array<{ amount: string }>): string {
  const total = recipients.reduce((sum, row) => {
    const n = Number.parseFloat(row.amount.replaceAll(",", ""));
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);
  return total.toLocaleString("en-US", { maximumFractionDigits: 9, useGrouping: false });
}
async function requireAdmin() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
export async function GET() {
  try {
    return NextResponse.json(await readAdminArTokenMetrics());
  } catch (error) {
    if (isAdminOperationsUnauthorized(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[admin/ar-token] GET error:", error);
    const detail = process.env.NODE_ENV === "development" && error instanceof Error ? error.message : undefined;
    return NextResponse.json(
      { error: "Failed to fetch token metrics", ...(detail ? { detail } : {}) },
      { status: 500 },
    );
  }
}
export async function PUT(request: NextRequest) {
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;
  try {
    const body = await request.json();
    const data = {
      launchStatus: asTrimmedString(body.launchStatus, 40) || "prelaunch",
      tokenAddress: asTrimmedString(body.tokenAddress, 120),
      pairAddress: asTrimmedString(body.pairAddress, 120),
      dexScreenerUrl: asTrimmedString(body.dexScreenerUrl, 300),
      pumpFunUrl: asTrimmedString(body.pumpFunUrl, 300),
      buyUrl: asTrimmedString(body.buyUrl, 300),
      treasuryWallet: asTrimmedString(body.treasuryWallet, 120),
      rewardsWallet: asTrimmedString(body.rewardsWallet, 120),
      buybackWallet: asTrimmedString(body.buybackWallet, 120),
      burnWallet: asTrimmedString(body.burnWallet, 120),
      liquidityWallet: asTrimmedString(body.liquidityWallet, 120),
      holderAccessThreshold: asTrimmedString(body.holderAccessThreshold, 60),
      tokenLedger: parseTokenLedger(body.tokenLedger),
      solanaCluster: parseSolanaCluster(body.solanaCluster),
      tokenChainId: parseChainId(body.tokenChainId),
      tokenDecimals: parseTokenDecimals(body.tokenDecimals),
      stakingEnabled: Boolean(body.stakingEnabled),
    };
    await prisma.arTokenSettings.upsert({
      where: { id: AR_TOKEN_SETTING_ID },
      create: { id: AR_TOKEN_SETTING_ID, ...data },
      update: data,
    });
    return NextResponse.json(await readArTokenMetricsPayload({ includeAdminRows: true }));
  } catch (err) {
    console.error("[admin/ar-token] PUT error:", err);
    return NextResponse.json({ error: "Failed to save token settings" }, { status: 500 });
  }
}
export async function POST(request: NextRequest) {
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;
  try {
    const body = await request.json();
    const action = asTrimmedString(body.action, 60);
    if (action === "save_perks") {
      const rows = Array.isArray(body.perks) ? body.perks : DEFAULT_AR_TOKEN_PERK_CONFIGS;
      await Promise.all(
        rows.map((row: Record<string, unknown>, index: number) => {
          const slug = asTrimmedString(row.slug, 80) || `perk-${index + 1}`;
          return prisma.arTokenPerkConfig.upsert({
            where: { slug },
            create: {
              slug,
              title: asTrimmedString(row.title, 120) || slug,
              shortTitle: asTrimmedString(row.shortTitle, 80),
              description: asTrimmedString(row.description, 1200),
              rewardSummary: asTrimmedString(row.rewardSummary, 1200),
              minBalanceRaw: parseBalanceRaw(row.minBalanceRaw),
              maxBalanceRaw: parseBalanceRaw(row.maxBalanceRaw),
              status: parsePerkStatus(row.status),
              displayOrder: parseIntClamped(row.displayOrder, index * 10, 0, 10_000),
              ctaLabel: asTrimmedString(row.ctaLabel, 80),
              ctaHref: asTrimmedString(row.ctaHref, 200),
            },
            update: {
              title: asTrimmedString(row.title, 120) || slug,
              shortTitle: asTrimmedString(row.shortTitle, 80),
              description: asTrimmedString(row.description, 1200),
              rewardSummary: asTrimmedString(row.rewardSummary, 1200),
              minBalanceRaw: parseBalanceRaw(row.minBalanceRaw),
              maxBalanceRaw: parseBalanceRaw(row.maxBalanceRaw),
              status: parsePerkStatus(row.status),
              displayOrder: parseIntClamped(row.displayOrder, index * 10, 0, 10_000),
              ctaLabel: asTrimmedString(row.ctaLabel, 80),
              ctaHref: asTrimmedString(row.ctaHref, 200),
            },
          });
        }),
      );
      return NextResponse.json(await readArTokenMetricsPayload({ includeAdminRows: true }));
    }
    if (action === "upsert_holder") {
      const wallet = asTrimmedString(body.wallet, 140);
      if (!wallet) return NextResponse.json({ error: "wallet is required" }, { status: 400 });
      await prisma.arTokenHolderSnapshot.upsert({
        where: { wallet },
        create: {
          wallet,
          tokenBalanceRaw: parseBalanceRaw(body.tokenBalanceRaw),
          tokenBalanceUi: asTrimmedString(body.tokenBalanceUi, 80),
          achievedTier: asTrimmedString(body.achievedTier, 80),
          eligiblePerks: asStringArray(body.eligiblePerks),
          referralCount: parseIntClamped(body.referralCount, 0, 0),
          manualReferralAdjust: parseIntClamped(body.manualReferralAdjust),
          paidVerifiedAgentCount: parseIntClamped(body.paidVerifiedAgentCount, 0, 0),
          claimedAgentCount: parseIntClamped(body.claimedAgentCount, 0, 0),
          profilePath: asTrimmedString(body.profilePath, 240),
          source: asTrimmedString(body.source, 40) || "manual",
          note: asTrimmedString(body.note, 500),
          lastSyncedAt: new Date(),
        },
        update: {
          tokenBalanceRaw: parseBalanceRaw(body.tokenBalanceRaw),
          tokenBalanceUi: asTrimmedString(body.tokenBalanceUi, 80),
          achievedTier: asTrimmedString(body.achievedTier, 80),
          eligiblePerks: asStringArray(body.eligiblePerks),
          referralCount: parseIntClamped(body.referralCount, 0, 0),
          manualReferralAdjust: parseIntClamped(body.manualReferralAdjust),
          paidVerifiedAgentCount: parseIntClamped(body.paidVerifiedAgentCount, 0, 0),
          claimedAgentCount: parseIntClamped(body.claimedAgentCount, 0, 0),
          profilePath: asTrimmedString(body.profilePath, 240),
          source: asTrimmedString(body.source, 40) || "manual",
          note: asTrimmedString(body.note, 500),
          lastSyncedAt: new Date(),
        },
      });
      return NextResponse.json(await readArTokenMetricsPayload({ includeAdminRows: true }));
    }
    if (action === "adjust_referral") {
      const code = asTrimmedString(body.code, 80);
      const ownerWallet = asTrimmedString(body.ownerWallet, 140);
      if (!code || !ownerWallet) return NextResponse.json({ error: "code and ownerWallet are required" }, { status: 400 });
      const referralCode = await prisma.arReferralCode.upsert({
        where: { code },
        create: {
          code,
          ownerWallet,
          destination: asTrimmedString(body.destination, 240) || getStakeSiteUrl(),
        },
        update: {
          ownerWallet,
          destination: asTrimmedString(body.destination, 240) || getStakeSiteUrl(),
          isActive: Boolean(body.isActive ?? true),
        },
      });
      await prisma.arReferralAdjustment.create({
        data: {
          referralCodeId: referralCode.id,
          amount: parseIntClamped(body.amount, 0),
          reason: asTrimmedString(body.reason, 140),
          adminNote: asTrimmedString(body.adminNote, 500),
        },
      });
      return NextResponse.json(await readArTokenMetricsPayload({ includeAdminRows: true }));
    }
    if (action === "save_payout_wallet") {
      const id = asTrimmedString(body.id, 80);
      const data = {
        label: asTrimmedString(body.label, 100) || "Rewards wallet",
        wallet: asTrimmedString(body.wallet, 140),
        asset: asTrimmedString(body.asset, 20) || "SOL",
        purpose: asTrimmedString(body.purpose, 40) || "rewards",
        isActive: Boolean(body.isActive ?? true),
      };
      if (!data.wallet) return NextResponse.json({ error: "wallet is required" }, { status: 400 });
      if (id) {
        await prisma.arPayoutWallet.update({ where: { id }, data });
      } else {
        await prisma.arPayoutWallet.create({ data });
      }
      return NextResponse.json(await readArTokenMetricsPayload({ includeAdminRows: true }));
    }
    if (action === "create_payout_batch") {
      const amountValue = asTrimmedString(body.amountValue, 80) || "0";
      let recipients = parseRecipients(body.recipients);
      if (recipients.length === 0) {
        const perkSlug = asTrimmedString(body.perkSlug, 80);
        const perk = perkSlug ? await prisma.arTokenPerkConfig.findUnique({ where: { slug: perkSlug } }) : null;
        const minRaw = BigInt(parseBalanceRaw(body.minBalanceRaw || perk?.minBalanceRaw || "0"));
        const holders = await prisma.arTokenHolderSnapshot.findMany({ take: 250 });
        recipients = holders
          .filter((holder) => BigInt(parseBalanceRaw(holder.tokenBalanceRaw)) >= minRaw)
          .slice(0, 250)
          .map((holder) => ({ wallet: holder.wallet, amount: amountValue, note: perkSlug ? `Eligible for ${perkSlug}` : "Manual $AR payout" }));
      }
      await prisma.arPayoutBatch.create({
        data: {
          title: asTrimmedString(body.title, 120) || "Draft payout batch",
          perkSlug: asTrimmedString(body.perkSlug, 80),
          asset: asTrimmedString(body.asset, 20) || "AR",
          amountMode: asTrimmedString(body.amountMode, 40) || "fixed",
          amountValue,
          totalAmount: totalAmount(recipients),
          recipientCount: recipients.length,
          recipients,
          status: "draft",
          adminNotes: asTrimmedString(body.adminNotes, 1000),
        },
      });
      return NextResponse.json(await readArTokenMetricsPayload({ includeAdminRows: true }));
    }
    if (action === "mark_payout_batch") {
      const id = asTrimmedString(body.id, 80);
      if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
      await prisma.arPayoutBatch.update({
        where: { id },
        data: {
          status: asTrimmedString(body.status, 40) || "exported",
          txSignatures: asStringArray(body.txSignatures),
          adminNotes: asTrimmedString(body.adminNotes, 1000),
        },
      });
      return NextResponse.json(await readArTokenMetricsPayload({ includeAdminRows: true }));
    }
    const eventTypeRaw = asTrimmedString(body.eventType, 40);
    if (!isArTokenEventType(eventTypeRaw)) {
      return NextResponse.json(
        { error: `eventType must be one of: ${AR_TOKEN_EVENT_TYPES.join(", ")}` },
        { status: 400 }
      );
    }
    const settingsRow = await prisma.arTokenSettings.findUnique({ where: { id: AR_TOKEN_SETTING_ID } });
    const settingsView = normalizeArTokenSettings(settingsRow);
    const amountToken = asTrimmedString(body.amountToken, 80);
    const amountUsd = asTrimmedString(body.amountUsd, 80);
    const wallet = asTrimmedString(body.wallet, 120);
    const txHash = asTrimmedString(body.txHash, 140);
    const note = asTrimmedString(body.note, 1000);
    const validated = validateMetricEventInput(settingsView, {
      eventType: eventTypeRaw,
      amountToken,
      amountUsd,
      wallet,
      txHash,
      note,
    });
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }
    if (txHash) {
      const dupWhere =
        settingsView.tokenLedger === "evm"
          ? {
              eventType: eventTypeRaw,
              txHash: { equals: txHash, mode: "insensitive" as const },
            }
          : { eventType: eventTypeRaw, txHash };
      const existing = await prisma.arTokenMetricEvent.findFirst({
        where: dupWhere,
        select: { id: true },
      });
      if (existing) {
        return NextResponse.json(
          { error: "An event with this tx hash already exists for this event type." },
          { status: 409 }
        );
      }
    }
    await prisma.arTokenMetricEvent.create({
      data: {
        eventType: eventTypeRaw,
        amountToken,
        amountUsd,
        wallet,
        txHash,
        note,
        occurredAt: parseOccurredAt(body.occurredAt),
      },
    });
    return NextResponse.json(await readArTokenMetricsPayload({ includeAdminRows: true }));
  } catch (err) {
    console.error("[admin/ar-token] POST error:", err);
    return NextResponse.json({ error: "Failed to record token event" }, { status: 500 });
  }
}
