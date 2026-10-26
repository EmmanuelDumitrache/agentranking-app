import { isArCardDemoFlowActive } from "../config";
import { KripicardFundingProvider } from "./funding/kripicard";
import { MockPaymentProvider } from "./funding/mock";
import { KripicardIssuer } from "./card/kripicard-issuer";
import { MockCardIssuerProvider } from "./card/mock";
import { getKripicardConfig } from "./card/kripicard-config";
import type {
  CardIssuerProvider,
  KripicardCardIssuerProvider,
  PaymentProvider,
  WalletProvider,
} from "./types";

export type FundingProviderId = "mock" | "kripicard";
export type CardIssuerProviderId = "mock" | "ar";

function readFundingProviderId(): FundingProviderId {
  // Demo flow skips real USDT deposits.
  if (isArCardDemoFlowActive()) return "mock";
  if (getKripicardConfig().configured) return "kripicard";
  const raw = (process.env.FUNDING_PROVIDER ?? "mock").trim().toLowerCase();
  if (raw === "kripicard" || raw === "ar") return "kripicard";
  return "mock";
}

function readCardIssuerProviderId(): CardIssuerProviderId {
  // Keep AR issuer so demo still uses the real UI path (BIN, reveal, fund).
  if (isArCardDemoFlowActive()) return "ar";
  if (getKripicardConfig().configured) return "ar";
  const raw = (process.env.CARD_ISSUER_PROVIDER ?? process.env.CARD_ISSUER ?? "mock")
    .trim()
    .toLowerCase();
  if (raw === "kripicard" || raw === "ar") return "ar";
  return "mock";
}

const mockPayment = new MockPaymentProvider();
const kripicardPayment = new KripicardFundingProvider();
const mockCardIssuer = new MockCardIssuerProvider();
let kripicardIssuer: KripicardIssuer | null = null;

function getKripicardIssuer(): KripicardIssuer {
  kripicardIssuer ??= new KripicardIssuer();
  return kripicardIssuer;
}

/** Factory — all app code imports providers from here, never from concrete modules. */
export function getPaymentProvider(): PaymentProvider {
  const id = readFundingProviderId();
  switch (id) {
    case "kripicard":
      return kripicardPayment;
    case "mock":
      return mockPayment;
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

export function getCardIssuerProvider(): CardIssuerProvider {
  const id = readCardIssuerProviderId();
  switch (id) {
    case "ar":
      return getKripicardIssuer();
    case "mock":
      return mockCardIssuer;
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

export function getKripicardCardIssuer(): KripicardCardIssuerProvider {
  return getKripicardIssuer();
}

export function isKripicardIssuerActive(): boolean {
  return readCardIssuerProviderId() === "ar";
}


/** Internal ledger is source of truth; external wallet rails are optional. */
export function getWalletProvider(): WalletProvider {
  return { name: "internal-ledger" };
}

export type {
  CardIssuerProvider,
  CardIssuerEligibilityParams,
  CardIssuerEligibilityResult,
  KripicardCardIssuerProvider,
  PaymentProvider,
  WalletProvider,
} from "./types";
