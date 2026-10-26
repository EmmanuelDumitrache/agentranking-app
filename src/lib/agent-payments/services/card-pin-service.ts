import { compare, hash } from "bcryptjs";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "./audit-service";

const PIN_PATTERN = /^\d{4}$/;

export class CardPinRequiredError extends Error {
  readonly code = "pin_required" as const;

  constructor() {
    super("Enter your 4-digit freeze PIN");
    this.name = "CardPinRequiredError";
  }
}

export class CardPinInvalidError extends Error {
  readonly code = "pin_invalid" as const;

  constructor() {
    super("Incorrect freeze PIN");
    this.name = "CardPinInvalidError";
  }
}

export function normalizeFreezePin(pin: string): string {
  return pin.replace(/\D/g, "").slice(0, 4);
}

export function assertValidFreezePinFormat(pin: string) {
  if (!PIN_PATTERN.test(normalizeFreezePin(pin))) {
    throw new Error("PIN must be exactly 4 digits");
  }
}

async function hashFreezePin(pin: string): Promise<string> {
  assertValidFreezePinFormat(pin);
  return hash(normalizeFreezePin(pin), 10);
}

async function verifyFreezePin(pin: string, hashValue: string): Promise<boolean> {
  return compare(normalizeFreezePin(pin), hashValue);
}

export async function cardHasFreezePin(appAccountId: string, cardId: string) {
  const card = await prisma.agentKripicardCard.findFirst({
    where: { id: cardId, appAccountId },
    select: { freezePinHash: true },
  });
  return Boolean(card?.freezePinHash);
}

export async function assertFreezePinForCard(
  card: { freezePinHash: string | null },
  pin?: string,
) {
  if (!card.freezePinHash) return;
  if (!pin?.trim()) throw new CardPinRequiredError();
  const valid = await verifyFreezePin(pin, card.freezePinHash);
  if (!valid) throw new CardPinInvalidError();
}

export async function setCardFreezePin(params: {
  appAccountId: string;
  cardId: string;
  pin: string;
  confirmPin: string;
}) {
  assertValidFreezePinFormat(params.pin);
  assertValidFreezePinFormat(params.confirmPin);
  if (normalizeFreezePin(params.pin) !== normalizeFreezePin(params.confirmPin)) {
    throw new Error("PIN entries do not match");
  }

  const card = await prisma.agentKripicardCard.findFirst({
    where: { id: params.cardId, appAccountId: params.appAccountId },
  });
  if (!card || card.status === "CANCELLED") throw new Error("Card not found");

  const freezePinHash = await hashFreezePin(params.pin);
  const updated = await prisma.agentKripicardCard.update({
    where: { id: card.id },
    data: { freezePinHash },
  });

  await writeAuditLog({
    appAccountId: params.appAccountId,
    action: "card.freeze_pin_set",
    entityType: "agent_kripicard_card",
    entityId: card.id,
  }).catch(() => undefined);

  return updated;
}

export async function removeCardFreezePin(params: {
  appAccountId: string;
  cardId: string;
  pin: string;
}) {
  const card = await prisma.agentKripicardCard.findFirst({
    where: { id: params.cardId, appAccountId: params.appAccountId },
  });
  if (!card || card.status === "CANCELLED") throw new Error("Card not found");
  if (!card.freezePinHash) throw new Error("No freeze PIN on this card");

  await assertFreezePinForCard(card, params.pin);

  const updated = await prisma.agentKripicardCard.update({
    where: { id: card.id },
    data: { freezePinHash: null },
  });

  await writeAuditLog({
    appAccountId: params.appAccountId,
    action: "card.freeze_pin_removed",
    entityType: "agent_kripicard_card",
    entityId: card.id,
  }).catch(() => undefined);

  return updated;
}
