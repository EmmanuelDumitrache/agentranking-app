import { prisma } from "@/lib/db";
import { maxDailyLimitUsdForTier } from "@/lib/verification/card-tier-limits";
import type {
  CardDetailsReveal,
  CardIssuerEligibilityParams,
  CardIssuerEligibilityResult,
  CardIssuerRiskTier,
  IssueCardParams,
  IssuedCard,
  KripicardCardIssuerProvider,
} from "../types";
import { getArCardBinOption, isKnownArCardBin } from "./ar-card-bins";
import {
  addDemoArCardBalance,
  buildDemoArCardSecrets,
  getDemoArCardSecrets,
  isDemoArCardId,
  newDemoArCardId,
  shouldUseArCardDemoFlow,
} from "./ar-card-demo";
import {
  inferCardBrand,
  kripicardCardDetails,
  kripicardCardTransactions,
  kripicardCreateCard,
  kripicardDeleteCard,
  kripicardFreezeUnfreeze,
  kripicardFundCard,
  formatKripicardExpiryDisplay,
  parseKripicardExpiry,
} from "./kripicard-api";
import { binForRiskTier, binsRequiringDateOfBirth, getKripicardConfig } from "./kripicard-config";

function mapKripicardStatus(status: string | undefined): IssuedCard["status"] {
  switch ((status ?? "").toLowerCase()) {
    case "active":
      return "active";
    case "frozen":
    case "freeze":
    case "suspended":
      return "frozen";
    case "deleted":
    case "cancelled":
      return "cancelled";
    default:
      return "pending";
  }
}

function toDbStatus(status: IssuedCard["status"]): "ACTIVE" | "FROZEN" | "CANCELLED" | "PENDING" {
  switch (status) {
    case "active":
      return "ACTIVE";
    case "frozen":
      return "FROZEN";
    case "cancelled":
      return "CANCELLED";
    case "pending":
    default:
      return "PENDING";
  }
}

/**
 * AgentRanking virtual cards — powered by Kripicard prepaid API, branded as AR in the UI.
 */
export class KripicardIssuer implements KripicardCardIssuerProvider {
  readonly name = "ar";
  readonly supportsVirtualCards = true;
  readonly supportsPrepaidBalance = true;

  async checkEligibility(
    params: CardIssuerEligibilityParams,
  ): Promise<CardIssuerEligibilityResult> {
    const maxDailyLimitUsd = maxDailyLimitUsdForTier(params.riskTier);
    const eligible =
      params.riskTier !== "UNRATED" &&
      params.riskScore >= 20 &&
      maxDailyLimitUsd > 0;

    const reasons: string[] = [];
    if (params.riskTier === "UNRATED") {
      reasons.push("Complete agent verification before issuing an AR card");
    }
    if (params.riskScore < 20) {
      reasons.push("Risk score below minimum threshold");
    }
    if (eligible) {
      reasons.push(`Tier ${params.riskTier} — up to $${maxDailyLimitUsd}/day spend`);
    }

    return { eligible, maxDailyLimitUsd: eligible ? maxDailyLimitUsd : 0, reasons };
  }

  async createVirtualCard(params: {
    agentId?: number | null;
    appAccountId: string;
    agentName?: string;
    riskTier: CardIssuerRiskTier;
    amountUsd: number;
    bin?: string;
    nameOnCard?: string;
    email?: string;
    dateOfBirth?: string;
    idempotencyKey: string;
  }): Promise<IssuedCard & { kripicardCardId: string; bin: string }> {
    const demo = shouldUseArCardDemoFlow();
    if (!demo && !getKripicardConfig().configured) {
      throw new Error("AR cards are not configured — set KRIPICARD_API_KEY.");
    }
    if (params.amountUsd < 10) {
      throw new Error("Minimum initial card balance is $10.");
    }

    const requestedBin = params.bin?.trim();
    if (requestedBin && !isKnownArCardBin(requestedBin) && !/^\d{6,8}$/.test(requestedBin)) {
      throw new Error("Unknown card BIN — pick a location from the list.");
    }
    const bin = requestedBin || binForRiskTier(params.riskTier);
    const binMeta = getArCardBinOption(bin);
    if (
      !demo &&
      (binMeta?.requiresDateOfBirth || binsRequiringDateOfBirth().has(bin)) &&
      !params.dateOfBirth
    ) {
      throw new Error("Date of birth (YYYY-MM-DD) is required for this card location.");
    }

    const nameOnCard = (
      params.nameOnCard ??
      (params.agentName ? `AR ${params.agentName}` : "AR AGENT")
    ).slice(0, 64);

    let cardId: string;
    let lastFour: string;
    let brand: string;
    let resolvedBin = bin;

    if (demo) {
      cardId = newDemoArCardId();
      const secrets = buildDemoArCardSecrets({
        cardId,
        bin,
        amountUsd: params.amountUsd,
      });
      lastFour = secrets.pan.slice(-4);
      brand = inferCardBrand(bin, binMeta?.network);
      resolvedBin = bin;
    } else {
      const created = await kripicardCreateCard({
        bin,
        amountUsd: params.amountUsd,
        nameOnCard,
        email: params.email,
        dateOfBirth: params.dateOfBirth,
      });
      cardId = created.card_id;
      lastFour = created.last_4 ?? "0000";
      brand = inferCardBrand(created.bin ?? bin, binMeta?.network);
      resolvedBin = created.bin ?? bin;
    }

    await prisma.agentKripicardCard.create({
      data: {
        agentId: params.agentId ?? null,
        appAccountId: params.appAccountId,
        kripicardCardId: cardId,
        bin: resolvedBin,
        lastFour,
        brand,
        nameOnCard,
        status: "ACTIVE",
        riskTier: params.riskTier,
        initialAmountUsd: params.amountUsd,
      },
    });

    return {
      providerCardId: cardId,
      lastFour,
      brand,
      expiryMonth: null,
      expiryYear: null,
      status: "active",
      kripicardCardId: cardId,
      bin: resolvedBin,
    };
  }

  async fundCard(params: { cardId: string; amountUsd: number }) {
    if (params.amountUsd < 10) {
      throw new Error("Minimum top-up is $10.");
    }
    if (shouldUseArCardDemoFlow() || isDemoArCardId(params.cardId)) {
      const balanceUsd = addDemoArCardBalance(params.cardId, params.amountUsd);
      await prisma.agentKripicardCard.updateMany({
        where: { kripicardCardId: params.cardId },
        data: { initialAmountUsd: balanceUsd },
      });
      return {
        data: {
          card_id: params.cardId,
          amount: params.amountUsd,
          fee: 0,
          total_debited: params.amountUsd,
        },
      };
    }
    return kripicardFundCard({ cardId: params.cardId, amountUsd: params.amountUsd });
  }

  async issueCard(_params: IssueCardParams): Promise<IssuedCard> {
    throw new Error("Use createVirtualCard with agent context for AR cards.");
  }

  async freezeCard(providerCardId: string): Promise<{ ok: boolean }> {
    if (!(shouldUseArCardDemoFlow() || isDemoArCardId(providerCardId))) {
      await kripicardFreezeUnfreeze({ cardId: providerCardId, action: "freeze" });
    }
    await prisma.agentKripicardCard.updateMany({
      where: { kripicardCardId: providerCardId },
      data: { status: "FROZEN" },
    });
    return { ok: true };
  }

  async unfreezeCard(providerCardId: string): Promise<{ ok: boolean }> {
    if (!(shouldUseArCardDemoFlow() || isDemoArCardId(providerCardId))) {
      await kripicardFreezeUnfreeze({ cardId: providerCardId, action: "unfreeze" });
    }
    await prisma.agentKripicardCard.updateMany({
      where: { kripicardCardId: providerCardId },
      data: { status: "ACTIVE" },
    });
    return { ok: true };
  }

  async cancelCard(providerCardId: string): Promise<{ ok: boolean }> {
    if (!(shouldUseArCardDemoFlow() || isDemoArCardId(providerCardId))) {
      await kripicardDeleteCard({ cardId: providerCardId });
    }
    await prisma.agentKripicardCard.updateMany({
      where: { kripicardCardId: providerCardId },
      data: { status: "CANCELLED" },
    });
    return { ok: true };
  }

  async getCard(providerCardId: string): Promise<IssuedCard | null> {
    const row = await prisma.agentKripicardCard.findFirst({
      where: { kripicardCardId: providerCardId },
    });
    if (!row || row.status === "CANCELLED") return null;
    return {
      providerCardId: row.kripicardCardId,
      lastFour: row.lastFour,
      brand: row.brand,
      expiryMonth: null,
      expiryYear: null,
      status: row.status === "ACTIVE" ? "active" : "frozen",
    };
  }

  async getCardDetails(providerCardId: string): Promise<CardDetailsReveal> {
    const row = await prisma.agentKripicardCard.findFirst({
      where: { kripicardCardId: providerCardId },
      select: { nameOnCard: true, lastFour: true, bin: true, initialAmountUsd: true },
    });

    if (shouldUseArCardDemoFlow() || isDemoArCardId(providerCardId)) {
      const secrets =
        getDemoArCardSecrets(providerCardId) ??
        buildDemoArCardSecrets({
          cardId: providerCardId,
          bin: row?.bin ?? "441357",
          amountUsd: row?.initialAmountUsd ?? 0,
        });
      if (row && secrets.balanceUsd <= 0 && row.initialAmountUsd > 0) {
        secrets.balanceUsd = row.initialAmountUsd;
      }
      return {
        revealMode: "inline",
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        credentials: {
          pan: secrets.pan,
          cvv: secrets.cvv,
          expiryMonth: secrets.expiryMonth,
          expiryYear: secrets.expiryYear,
          expiryDisplay: `${String(secrets.expiryMonth).padStart(2, "0")}/${String(
            secrets.expiryYear,
          ).slice(-2)}`,
          cardholderName: row?.nameOnCard ?? "AR AGENT",
        },
        balanceUsd: secrets.balanceUsd || row?.initialAmountUsd || 0,
        cardStatus: "active",
      };
    }

    const details = await kripicardCardDetails({
      cardId: providerCardId,
      lastFour: row?.lastFour,
    });
    const { expiryMonth, expiryYear } = parseKripicardExpiry(details.expiry);
    const expiryDisplay = formatKripicardExpiryDisplay(
      details.expiry,
      expiryMonth,
      expiryYear,
    );

    return {
      revealMode: "inline",
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      credentials: {
        pan: details.cardNumber,
        cvv: details.cvv,
        expiryMonth: expiryMonth ?? 1,
        expiryYear: expiryYear ?? 2099,
        expiryDisplay,
        cardholderName: row?.nameOnCard ?? "AR AGENT",
      },
      balanceUsd: details.balance ?? undefined,
      cardStatus: mapKripicardStatus(details.status ?? undefined),
    };
  }

  async getCardTransactions(providerCardId: string) {
    if (shouldUseArCardDemoFlow() || isDemoArCardId(providerCardId)) {
      return [];
    }
    const result = await kripicardCardTransactions({ cardId: providerCardId });
    const rows = result.data?.transactions ?? [];
    return rows.map((tx, index) => ({
      providerTransactionId: `${providerCardId}:${tx.date}:${index}`,
      amountCents: Math.round(tx.amount * 100),
      merchant: tx.merchant ?? null,
      status: tx.status,
      createdAt: new Date(tx.date.replace(" ", "T")),
    }));
  }
}

export function mapKripicardCardToDbStatus(status: IssuedCard["status"]) {
  return toDbStatus(status);
}
