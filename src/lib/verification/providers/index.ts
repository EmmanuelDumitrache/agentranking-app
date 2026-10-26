import { getKycProviderId } from "@/lib/verification/config";
import { HostedKycProviderStub } from "./kyc/civic";
import { MockKycProvider } from "./kyc/mock";
import { PersonaKycProvider } from "./kyc/persona";
import { ArVerificationCardIssuer } from "./issuer/ar";
import { MockCardIssuer } from "./issuer/mock";
import type { CardIssuer, KycProvider } from "./types";

export type KycProviderId = "mock" | "civic" | "persona";
export type CardIssuerId = "mock" | "ar";

function readCardIssuerId(): CardIssuerId {
  const raw = (process.env.CARD_ISSUER ?? process.env.CARD_ISSUER_PROVIDER ?? "mock")
    .trim()
    .toLowerCase();
  if (raw === "kripicard" || raw === "ar") return "ar";
  return "mock";
}

/** Factory — all app code imports providers from here, never from concrete modules. */
export function getKycProvider(): KycProvider {
  const id = getKycProviderId();
  switch (id) {
    case "civic":
      return new HostedKycProviderStub();
    case "persona":
      return new PersonaKycProvider();
    case "mock":
      return new MockKycProvider();
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

/** Factory — all app code imports issuers from here, never from concrete modules. */
export function getCardIssuer(): CardIssuer {
  const id = readCardIssuerId();
  switch (id) {
    case "ar":
      return new ArVerificationCardIssuer();
    case "mock":
      return new MockCardIssuer();
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

export type { CardIssuer, KycProvider, RiskTier, PassportStatus } from "./types";
