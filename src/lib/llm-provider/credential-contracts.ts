export type LlmProviderCredentialState =
  | "disconnected"
  | "valid"
  | "invalid"
  | "temporarily_unavailable"
  | "revoked";

export type LlmProviderDescriptor = {
  id: string;
  label: string;
  credentialLabel: string;
  description: string;
  helpUrl: string | null;
};

export type LlmProviderCredentialStatus = {
  provider: string;
  state: LlmProviderCredentialState;
  fingerprint: string | null;
  validatedAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  modelCount: number | null;
};

export type LlmProviderCredentialsResponse = {
  providers: LlmProviderDescriptor[];
  /** One independent credential slot per supported provider. */
  credentials: LlmProviderCredentialStatus[];
  connectedProviderCount: number;
};
