import { randomInt, randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { isCardDevToolsActive } from "../config";
import { AR_CARD_BIN_CATALOG } from "../providers/card/ar-card-bins";
import { addDemoArCardBalance } from "../providers/card/ar-card-demo";
import { cancelCard, issueCard } from "./card-service";
import { listAccountAgents } from "./agent-service";
import { deposit, ensureTreasuryWallet, reserveInTx, spendFromReservedInTx } from "./wallet-service";
import { writeAuditLog } from "./audit-service";

const DEV_DISPLAY_NAMES = [
  "Dev Agent Alpha",
  "Test Spend Bot",
  "AR Demo Card",
  "Sandbox Trader",
  "Local QA Agent",
];

const DEV_MERCHANTS = [
  "OpenAI",
  "Amazon Web Services",
  "Google Ads",
  "Shopify",
  "Starlink",
  "Anthropic",
  "Vercel",
  "GitHub",
];

const DEV_CATEGORIES = ["saas", "ads", "cloud", "software", "subscriptions"];

function assertCardDevToolsActive(accountEmail?: string | null) {
  if (!isCardDevToolsActive(accountEmail)) {
    throw new Error("Card dev tools are not enabled");
  }
}

function pickRandom<T>(items: readonly T[]): T {
  return items[randomInt(items.length)]!;
}

export async function devGenerateRandomCard(
  appAccountId: string,
  agentId?: number | null,
  accountEmail?: string | null,
) {
  assertCardDevToolsActive(accountEmail);

  const agents = await listAccountAgents(appAccountId);
  const resolvedAgentId =
    agentId ??
    (agents.length > 0 ? pickRandom(agents).id : null);

  const eligibleBins = AR_CARD_BIN_CATALOG.filter((row) => !row.requiresDateOfBirth);
  const binOption = pickRandom(eligibleBins.length > 0 ? eligibleBins : AR_CARD_BIN_CATALOG);
  const amountUsd = 10 + randomInt(91);
  const displayName = pickRandom(DEV_DISPLAY_NAMES);

  const result = await issueCard({
    appAccountId,
    agentId: resolvedAgentId,
    displayName,
    amountUsd,
    bin: binOption.bin,
    idempotencyKey: `dev_card_${randomUUID()}`,
  });

  return {
    ...result,
    generated: {
      bin: binOption.bin,
      label: binOption.label,
      amountUsd,
      displayName,
      agentId: resolvedAgentId,
    },
  };
}

export async function devCancelAccountCard(
  appAccountId: string,
  cardId?: string,
  accountEmail?: string | null,
) {
  assertCardDevToolsActive(accountEmail);
  const cancelled = await cancelCard(appAccountId, cardId);
  return { card: cancelled };
}

export async function devSimulateCardPayment(
  params: {
    appAccountId: string;
    cardId?: string;
    agentId?: number | null;
    amountCents?: number;
    merchant?: string;
    category?: string;
  },
  accountEmail?: string | null,
) {
  assertCardDevToolsActive(accountEmail);

  const amountCents = params.amountCents ?? 500 + randomInt(4501);
  const merchant = params.merchant?.trim() || pickRandom(DEV_MERCHANTS);
  const category = params.category?.trim() || pickRandom(DEV_CATEGORIES);

  const card = params.cardId
    ? await prisma.agentKripicardCard.findFirst({
        where: { id: params.cardId, appAccountId: params.appAccountId, status: { not: "CANCELLED" } },
      })
    : await prisma.agentKripicardCard.findFirst({
        where: { appAccountId: params.appAccountId, status: "ACTIVE" },
        orderBy: { createdAt: "desc" },
      });

  if (!card) {
    throw new Error("No active card found — generate a card first");
  }

  const agents = await listAccountAgents(params.appAccountId);
  const agentId =
    params.agentId ??
    (agents.length > 0 ? pickRandom(agents).id : null);

  const wallet = await ensureTreasuryWallet(params.appAccountId);
  const available = wallet.balanceUsdcCents - wallet.reservedUsdcCents;
  if (available < amountCents) {
    const topUpCents = Math.max(amountCents - available, 10_000);
    await deposit({
      appAccountId: params.appAccountId,
      amountCents: topUpCents,
      idempotencyKey: `dev_fund_${randomUUID()}`,
      metadata: { source: "card_dev_tools" },
    });
  }

  const idempotencyKey = `dev_spend_${randomUUID()}`;
  const providerTransactionId = `dev_tx_${randomUUID()}`;
  const spent = await prisma.$transaction(async (tx) => {
    const reserved = await reserveInTx(tx, {
      appAccountId: params.appAccountId,
      amountCents,
      agentId,
      cardId: card.id,
      merchant,
      category,
      reason: "dev_simulated_card_payment",
      idempotencyKey: `${idempotencyKey}:reserve`,
    });
    return spendFromReservedInTx(tx, {
      appAccountId: params.appAccountId,
      amountCents,
      agentId,
      cardId: card.id,
      merchant,
      category,
      reason: "dev_simulated_card_payment",
      providerTransactionId,
      reserveTransactionId: reserved.transaction.id,
      idempotencyKey,
    });
  });

  if (card.kripicardCardId.startsWith("demo_ar_")) {
    addDemoArCardBalance(card.kripicardCardId, -(amountCents / 100));
  }

  await writeAuditLog({
    appAccountId: params.appAccountId,
    action: "card.dev_spend_simulated",
    entityType: "agent_kripicard_card",
    entityId: card.id,
    metadata: {
      amountCents,
      merchant,
      category,
      agentId,
      transactionId: spent.transaction.id,
    },
  });

  return {
    transaction: spent.transaction,
    card: {
      id: card.id,
      lastFour: card.lastFour,
      merchant,
      amountCents,
    },
  };
}
