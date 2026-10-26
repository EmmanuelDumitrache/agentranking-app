declare module "@zkmedusa/passport-sdk" {
  export type MedusaPassport = Record<string, unknown>;
  export type VerifyPassportResult = {
    valid: boolean;
    errors?: string[];
    tier?: number;
    tierLabel?: string;
    nullifier?: string;
    expiresAt?: string | null;
  };
  export function parsePassportJson(input: string): MedusaPassport;
  export class MedusaPassportClient {
    constructor(config: { baseUrl: string; issuerPublicKey: string });
    verify(passport: unknown, options?: { minTier?: number }): Promise<VerifyPassportResult>;
  }
}