import {
  getCardIssuanceQuote,
  isArCardDemoFlowActive,
  isCardDevToolsActive,
  isCardIssuanceDevBypassActive,
} from "@/lib/agent-payments/config";
import { getCardIssuerProvider } from "@/lib/agent-payments/providers";
import {
  AR_CARD_BIN_CATALOG,
  estimateArCardFundFees,
  estimateArCardIssueFees,
} from "@/lib/agent-payments/providers/card/ar-card-bins";
import { getKripicardConfig } from "@/lib/agent-payments/providers/card/kripicard-config";

function readFundingProviderId(): string {
  if (isArCardDemoFlowActive()) return "mock";
  if (getKripicardConfig().configured) return "kripicard";
  const raw = (process.env.FUNDING_PROVIDER ?? "mock").trim().toLowerCase();
  if (raw === "kripicard" || raw === "ar") return "kripicard";
  return "mock";
}

function readCardIssuerProviderId(): string {
  if (isArCardDemoFlowActive()) return "ar";
  if (getKripicardConfig().configured) return "ar";
  const raw = (process.env.CARD_ISSUER_PROVIDER ?? process.env.CARD_ISSUER ?? "mock")
    .trim()
    .toLowerCase();
  if (raw === "kripicard" || raw === "ar") return "ar";
  return "mock";
}

export function buildWalletConfigPayload(accountEmail?: string | null) {
  const kripicard = getKripicardConfig();
  const demoFlow = isArCardDemoFlowActive();
  return {
    fundingProvider: readFundingProviderId(),
    cardIssuerProvider: readCardIssuerProviderId(),
    cardIssuerName: getCardIssuerProvider().name,
    brand: "AgentRanking",
    issuance: getCardIssuanceQuote(),
    oneCardPerAccount: false,
    demoFlow,
    bins: AR_CARD_BIN_CATALOG,
    feePreview: {
      issue: estimateArCardIssueFees(10),
      fund: estimateArCardFundFees(25),
    },
    kripicard: {
      configured: demoFlow || kripicard.configured,
      defaultCurrency: kripicard.defaultCurrency,
      defaultNetwork: kripicard.defaultNetwork,
      defaultBin: kripicard.defaultBin,
      minCardUsd: 10,
      minFundUsd: 10,
      minDepositUsd: 10,
    },
    devBypass: isCardIssuanceDevBypassActive(),
    devToolsActive: isCardDevToolsActive(accountEmail),
  };
}

export type WalletConfigPayload = ReturnType<typeof buildWalletConfigPayload>;
