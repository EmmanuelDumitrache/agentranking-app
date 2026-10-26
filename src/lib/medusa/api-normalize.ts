import {
  isMedusaPassportTier,
  isMedusaPassportUseCase,
} from "@/lib/medusa/metadata";
import type { MedusaPassportMetadataInput } from "@/lib/medusa/types";
/** Normalize dashboard/API body (flat or nested) into passport metadata input. */
export function normalizeMedusaPassportInput(body: unknown): MedusaPassportMetadataInput | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const nested =
    record.medusaPassport && typeof record.medusaPassport === "object"
      ? (record.medusaPassport as Record<string, unknown>)
      : record;
  const supportedRaw =
    nested.supported ??
    nested.medusaPassportSupported ??
    record.medusaPassportSupported;
  if (typeof supportedRaw !== "boolean") return null;
  const useCaseRaw =
    nested.useCase ?? nested.medusaPassportUseCase ?? record.medusaPassportUseCase;
  const minTierRaw = nested.minTier ?? nested.medusaMinTier ?? record.medusaMinTier;
  let useCase: MedusaPassportMetadataInput["useCase"] = null;
  if (useCaseRaw === null || useCaseRaw === undefined || useCaseRaw === "") {
    useCase = null;
  } else if (typeof useCaseRaw === "string" && isMedusaPassportUseCase(useCaseRaw)) {
    useCase = useCaseRaw;
  } else if (useCaseRaw != null) {
    return null;
  }
  let minTier: MedusaPassportMetadataInput["minTier"] = null;
  if (minTierRaw === null || minTierRaw === undefined || minTierRaw === "") {
    minTier = null;
  } else if (typeof minTierRaw === "string" && isMedusaPassportTier(minTierRaw)) {
    minTier = minTierRaw;
  } else if (minTierRaw != null) {
    return null;
  }
  return {
    supported: supportedRaw,
    useCase,
    minTier,
  };
}
