import {
  resolveMedusaBaseUrl,
  resolveMedusaIssuerPublicKey,
} from "@/lib/medusa/config";
import type { MedusaPassportTier } from "@/lib/medusa/types";
import { medusaTierToSdkTier, sdkTierNumberToMedusaTier } from "@/lib/medusa/tier-map";
export type MedusaPassportVerifyResponse = {
  readonly valid: boolean;
  readonly errors?: readonly string[];
  readonly tier?: number;
  readonly tierLabel?: string;
  readonly nullifier?: string;
  readonly expiresAt?: string | null;
  readonly meetsDeclaredMinTier: boolean;
  readonly declaredMinTier?: MedusaPassportTier;
  readonly sdkUnavailable?: boolean;
};
type PassportSdkModule = {
  readonly MedusaPassportClient: new (config: {
    baseUrl: string;
    issuerPublicKey: string;
  }) => {
    verify: (
      passport: unknown,
      options?: { minTier?: number },
    ) => Promise<{
      valid: boolean;
      errors?: string[];
      tier?: number;
      tierLabel?: string;
    }>;
  };
  readonly parsePassportJson: (input: string) => unknown;
};
function medusaPassportSdkEnabled(): boolean {
  const raw = process.env.MEDUSA_PASSPORT_SDK_ENABLED?.trim().toLowerCase();
  return raw === "1" || raw === "true";
}
async function loadPassportSdk(): Promise<PassportSdkModule | null> {
  if (!medusaPassportSdkEnabled()) return null;
  try {
    const mod = (await import(
      /* turbopackIgnore: true */
      "@zkmedusa/passport-sdk"
    )) as PassportSdkModule;
    return mod;
  } catch {
    return null;
  }
}
function parsePassportInput(
  sdk: PassportSdkModule,
  input: unknown,
): unknown {
  if (typeof input === "string") {
    return sdk.parsePassportJson(input.trim());
  }
  if (input && typeof input === "object") {
    return sdk.parsePassportJson(JSON.stringify(input));
  }
  throw new Error("Passport must be a JSON object or string");
}
export async function verifyMedusaPassportInput(
  passportInput: unknown,
  options?: { readonly minTier?: MedusaPassportTier },
): Promise<MedusaPassportVerifyResponse> {
  const sdk = await loadPassportSdk();
  if (!sdk) {
    return {
      valid: false,
      errors: ["SDK_UNAVAILABLE"],
      meetsDeclaredMinTier: false,
      declaredMinTier: options?.minTier,
      sdkUnavailable: true,
    };
  }
  const passport = parsePassportInput(sdk, passportInput);
  const baseUrl = resolveMedusaBaseUrl();
  const issuerPublicKey = resolveMedusaIssuerPublicKey();
  const client = new sdk.MedusaPassportClient({
    baseUrl,
    issuerPublicKey,
  });
  const minTierSdk = options?.minTier ? medusaTierToSdkTier(options.minTier) : undefined;
  const result = await client.verify(passport, {
    ...(minTierSdk != null ? { minTier: minTierSdk } : {}),
  });
  return {
    ...result,
    meetsDeclaredMinTier: result.valid,
    declaredMinTier: options?.minTier,
  };
}
/** Map SDK numeric tier to AgentRanking bronze/silver/gold label. */
export function sdkPassportTierToMedusaTier(
  tier: number | undefined,
): MedusaPassportTier | undefined {
  return sdkTierNumberToMedusaTier(tier);
}
export function isValidMedusaClaimWallet(value: string | undefined): boolean {
  if (!value?.trim()) return false;
  const wallet = value.trim();
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet);
}
