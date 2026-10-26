export type DashboardVerificationCheckDto = {
  label: string;
  passed: boolean;
};
export type DashboardVerificationTokenDto = {
  launchId: string;
  tokenName: string | null;
  tokenSymbol: string | null;
  mint: string | null;
  launchStatus: string;
  verificationStatus: string;
  verifiedAt: string | null;
  verificationSource: string | null;
};
export type DashboardVerificationStateDto = {
  agentId: number;
  agentName: string;
  agentImage: string;
  verificationStatus: string;
  verifiedAt: string | null;
  verificationTxSignature: string | null;
  verificationFeeLamports: number | null;
  verificationFeeSol: number | null;
  verificationWallet: string | null;
  verificationRecipient: string | null;
  feeSol: number;
  feeLamports: number;
  treasuryWallet: string | null;
  treasuryConfigured: boolean;
  agentWalletPublicKey: string | null;
  agentWalletBalanceSol: number | null;
  eligible: boolean;
  eligibilityReason: string;
  eligibilityChecks: DashboardVerificationCheckDto[];
  token: DashboardVerificationTokenDto | null;
  tokenExists: boolean;
  tokenLaunched: boolean;
  tokenVerificationEnabled: boolean;
};
