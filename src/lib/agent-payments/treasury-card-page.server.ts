import "server-only";

import type { Session } from "next-auth";
import { requireTreasurySession } from "@/lib/agent-payments/auth";
import { listArCards } from "@/lib/agent-payments/services/card-service";
import { listAccountAgents } from "@/lib/agent-payments/services/agent-service";
import { getWalletBalance } from "@/lib/agent-payments/services/wallet-service";
import { buildWalletConfigPayload } from "@/lib/agent-payments/wallet-config-payload";

export type TreasuryCardPageInitialData = {
  agents: { id: number; name: string }[];
  config: ReturnType<typeof buildWalletConfigPayload>;
  treasuryCents: number;
  cards: {
    id: string;
    lastFour: string;
    brand: string;
    status: string;
    bin?: string;
    nameOnCard?: string;
    initialAmountUsd?: number;
    pinSet?: boolean;
    createdAt?: string;
  }[];
  card: {
    id: string;
    lastFour: string;
    brand: string;
    status: string;
    bin?: string;
    nameOnCard?: string;
    kripicardCardId?: string;
    balanceUsd?: number;
    createdAt?: string;
  } | null;
};

export async function loadTreasuryCardPageData(
  session: Session | null,
): Promise<TreasuryCardPageInitialData | null> {
  const auth = await requireTreasurySession(session);
  if (!auth.ok) return null;

  const [agents, balance, cards] = await Promise.all([
    listAccountAgents(auth.appAccountId),
    getWalletBalance(auth.appAccountId),
    listArCards(auth.appAccountId),
  ]);

  const mapCard = (
    c: Awaited<ReturnType<typeof listArCards>>[number],
  ) => ({
    id: c.id,
    lastFour: c.lastFour,
    brand: c.brand,
    status: String(c.status).toLowerCase(),
    bin: c.bin,
    nameOnCard: c.nameOnCard,
    initialAmountUsd: c.initialAmountUsd,
    pinSet: c.pinSet,
    createdAt: c.createdAt.toISOString(),
  });

  return {
    agents: agents.map((agent) => ({ id: agent.id, name: agent.name })),
    config: buildWalletConfigPayload(session?.user?.email),
    treasuryCents: balance.availableUsdcCents,
    cards: cards.map(mapCard),
    card: cards[0] ? mapCard(cards[0]) : null,
  };
}
