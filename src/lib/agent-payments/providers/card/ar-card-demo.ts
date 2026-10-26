import { randomBytes } from "node:crypto";
import { isArCardDemoFlowActive } from "../../config";

type DemoCardSecrets = {
  pan: string;
  cvv: string;
  expiryMonth: number;
  expiryYear: number;
  balanceUsd: number;
};

const demoSecrets = new Map<string, DemoCardSecrets>();

function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function isDemoArCardId(cardId: string): boolean {
  return cardId.startsWith("demo_ar_");
}

export function shouldUseArCardDemoFlow(): boolean {
  return isArCardDemoFlowActive();
}

/** Deterministic demo PAN/CVV so reveal works after server restart. */
export function buildDemoArCardSecrets(params: {
  cardId: string;
  bin: string;
  amountUsd: number;
}): DemoCardSecrets {
  const existing = demoSecrets.get(params.cardId);
  if (existing) return existing;

  const bin = params.bin.replace(/\D/g, "").padEnd(6, "0").slice(0, 6);
  const h = hash(params.cardId);
  const mid = String(1_000_000_000 + (h % 9_000_000_000)).slice(0, 6);
  const last4 = String(1000 + (h % 9000));
  const pan = `${bin}${mid}${last4}`.slice(0, 16);
  const now = new Date();
  const secrets: DemoCardSecrets = {
    pan,
    cvv: String(100 + (h % 900)),
    expiryMonth: ((now.getUTCMonth() + 3) % 12) + 1,
    expiryYear: now.getUTCFullYear() + 3,
    balanceUsd: params.amountUsd,
  };
  demoSecrets.set(params.cardId, secrets);
  return secrets;
}

export function getDemoArCardSecrets(cardId: string): DemoCardSecrets | null {
  if (!isDemoArCardId(cardId)) return null;
  const cached = demoSecrets.get(cardId);
  if (cached) return cached;
  // Rebuild with zero balance if process restarted; caller can overlay DB amount.
  return buildDemoArCardSecrets({ cardId, bin: "441357", amountUsd: 0 });
}

export function setDemoArCardBalance(cardId: string, balanceUsd: number) {
  const secrets = getDemoArCardSecrets(cardId);
  if (!secrets) return;
  secrets.balanceUsd = balanceUsd;
  demoSecrets.set(cardId, secrets);
}

export function addDemoArCardBalance(cardId: string, amountUsd: number): number {
  const secrets = getDemoArCardSecrets(cardId);
  if (!secrets) return amountUsd;
  secrets.balanceUsd = Math.round((secrets.balanceUsd + amountUsd) * 100) / 100;
  demoSecrets.set(cardId, secrets);
  return secrets.balanceUsd;
}

export function newDemoArCardId(): string {
  return `demo_ar_${randomBytes(8).toString("hex")}`;
}
