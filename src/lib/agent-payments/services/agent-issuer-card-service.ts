import { prisma } from "@/lib/db";
import { getKripicardCardIssuer, isKripicardIssuerActive } from "../providers";
import { getCardDetails } from "./card-service";

type AgentCardRecord = {
  agent: { id: number; name: string };
  issuer: string;
  card: {
    id: string;
    providerCardId: string;
    lastFour: string;
    brand: string;
    status: string;
    expiryMonth?: number | null;
    expiryYear?: number | null;
    balanceUsd?: number;
  } | null;
};

import type { CardDetailsReveal } from "../providers/types";

function mapRevealToCredentials(reveal: CardDetailsReveal) {
  if (reveal.revealMode !== "inline" || !reveal.credentials) return null;
  const { pan, cvv } = reveal.credentials;
  if (!pan || !cvv) return null;

  const expiry =
    reveal.credentials.expiryDisplay ??
    `${String(reveal.credentials.expiryMonth).padStart(2, "0")}/${String(
      reveal.credentials.expiryYear,
    ).slice(-2)}`;

  return {
    pan,
    cvv,
    expiry,
    cardholderName: reveal.credentials.cardholderName ?? "AR AGENT",
    balanceUsd: reveal.balanceUsd,
  };
}

export async function getAgentCardRecord(
  agentId: number,
  appAccountId: string,
): Promise<AgentCardRecord | null> {
  const agent = await prisma.agent.findFirst({
    where: { id: agentId, ownerAccountId: appAccountId, isActive: true },
    select: { id: true, name: true },
  });
  if (!agent) return null;

  if (isKripicardIssuerActive()) {
    const arCard = await prisma.agentKripicardCard.findFirst({
      where: {
        appAccountId,
        agentId,
        status: { not: "CANCELLED" },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        kripicardCardId: true,
        lastFour: true,
        brand: true,
        status: true,
        bin: true,
        nameOnCard: true,
      },
    });
    if (arCard && arCard.status !== "CANCELLED") {
      return {
        agent,
        issuer: "ar",
        card: {
          id: arCard.id,
          providerCardId: arCard.kripicardCardId,
          lastFour: arCard.lastFour,
          brand: arCard.brand,
          status: arCard.status.toLowerCase(),
        },
      };
    }
    return { agent, issuer: "ar", card: null };
  }

  const paymentCard = await prisma.paymentCard.findUnique({
    where: { appAccountId },
    select: {
      id: true,
      providerCardId: true,
      lastFour: true,
      brand: true,
      status: true,
      expiryMonth: true,
      expiryYear: true,
    },
  });

  return {
    agent,
    issuer: "mock",
    card: paymentCard
      ? {
          id: paymentCard.id,
          providerCardId: paymentCard.providerCardId,
          lastFour: paymentCard.lastFour,
          brand: paymentCard.brand,
          status: paymentCard.status.toLowerCase(),
          expiryMonth: paymentCard.expiryMonth,
          expiryYear: paymentCard.expiryYear,
        }
      : null,
  };
}

export async function getAgentCardDetails(agentId: number, appAccountId: string) {
  const record = await getAgentCardRecord(agentId, appAccountId);
  if (!record?.card) throw new Error("No card for this agent");

  if (record.issuer === "ar") {
    const issuer = getKripicardCardIssuer();
    const reveal = await issuer.getCardDetails(record.card.providerCardId);
    return {
      agent: record.agent,
      card: record.card,
      reveal,
      credentials: mapRevealToCredentials(reveal),
      balanceUsd: reveal.balanceUsd,
    };
  }

  const details = await getCardDetails(appAccountId);
  return { ...details, agent: record.agent };
}
