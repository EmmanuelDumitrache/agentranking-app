import type {
  CardDetailsReveal,
  CardIssuerProvider,
  IssueCardParams,
  IssuedCard,
} from "../types";

type StoredCard = IssuedCard & {
  credentials: {
    pan: string;
    cvv: string;
    expiryMonth: number;
    expiryYear: number;
    cardholderName: string;
  };
};

/**
 * Demo card issuer. One virtual card per account; returns inline credentials for dev UI.
 */
export class MockCardIssuerProvider implements CardIssuerProvider {
  readonly name = "mock";
  readonly supportsVirtualCards = true;

  private readonly cards = new Map<string, StoredCard>();

  async issueCard(params: IssueCardParams): Promise<IssuedCard> {
    const providerCardId = `mock_card_${params.appAccountId}_${params.idempotencyKey.slice(0, 12)}`;
    const existing = [...this.cards.values()].find(
      (c) =>
        c.providerCardId.startsWith(`mock_card_${params.appAccountId}_`) &&
        c.status !== "cancelled",
    );
    if (existing) {
      return existing;
    }

    const now = new Date();
    const lastFour = String(1000 + (Math.abs(hashString(params.appAccountId)) % 9000));
    const pan = `453201${lastFour}9876`;
    const expiryMonth = ((now.getUTCMonth() + 1) % 12) + 1;
    const expiryYear = now.getUTCFullYear() + 3;

    const card: StoredCard = {
      providerCardId,
      lastFour,
      brand: "visa",
      expiryMonth,
      expiryYear,
      status: "active",
      credentials: {
        pan,
        cvv: String(100 + (Math.abs(hashString(providerCardId)) % 900)),
        expiryMonth,
        expiryYear,
        cardholderName: (params.displayName ?? "AGENT RANKING").toUpperCase(),
      },
    };
    this.cards.set(providerCardId, card);
    return card;
  }

  async freezeCard(providerCardId: string): Promise<{ ok: boolean }> {
    const card = this.cards.get(providerCardId);
    if (!card) return { ok: false };
    card.status = "frozen";
    return { ok: true };
  }

  async unfreezeCard(providerCardId: string): Promise<{ ok: boolean }> {
    const card = this.cards.get(providerCardId);
    if (!card) return { ok: false };
    card.status = "active";
    return { ok: true };
  }

  async cancelCard(providerCardId: string): Promise<{ ok: boolean }> {
    const card = this.cards.get(providerCardId);
    if (!card) return { ok: false };
    card.status = "cancelled";
    return { ok: true };
  }

  async getCard(providerCardId: string): Promise<IssuedCard | null> {
    return this.cards.get(providerCardId) ?? null;
  }

  async getCardDetails(providerCardId: string): Promise<CardDetailsReveal> {
    const card = this.cards.get(providerCardId);
    if (!card) {
      return { revealMode: "unavailable" };
    }
    return {
      revealMode: "inline",
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      credentials: card.credentials,
    };
  }

  async getCardTransactions(providerCardId: string) {
    if (!this.cards.has(providerCardId)) return [];
    return [];
  }
}

function hashString(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) | 0;
  return h;
}
