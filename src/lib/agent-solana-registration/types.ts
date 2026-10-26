export type AgentSolanaRegistrationStatus =
  | "registered"
  | "not_registered"
  | "insufficient_balance"
  | "no_wallet"
  | "unavailable";

export type AgentSolanaRegistrationOrigin = "created" | "imported";

export type AgentSolanaRegistrationPageData = {
  agentDbId: number;
  agentName: string;
  agentImage: string;
  agentDescription: string;
  capabilities: string[];
  origin: AgentSolanaRegistrationOrigin;
  status: AgentSolanaRegistrationStatus;
  walletPublicKey: string | null;
  walletBalanceSol: number | null;
  requiredBalanceSol: number;
  networkFeeLabel: string;
  listingUri: string;
  registrationFileUri: string;
  tokenMint: string | null;
  canStampArIdentity: boolean;
  canListPublicDirectory: boolean;
  registry: {
    identityProgramId: string;
    directoryProgramId: string;
    network: "Solana mainnet";
  };
  registration: {
    source: "public_directory" | "imported";
    directoryAsset: string | null;
    directoryPda: string | null;
    directoryTx: string | null;
    importedAddress: string | null;
    importedKind: "sap" | "metaplex" | null;
    arIdentityPda: string | null;
    arIdentityTx: string | null;
    registeredAt: string | null;
  } | null;
  /** True when on-chain reads failed due to RPC rate limits — status may be incomplete. */
  chainReadDegraded?: boolean;
};

export type AgentSolanaRegistrationResult = {
  directoryAsset: string | null;
  directoryPda: string | null;
  directoryTx: string | null;
  arIdentityPda: string | null;
  arIdentityTx: string | null;
  listingUri: string;
  registrationFileUri: string;
};

export type TryRegisterAgentResult =
  | { ok: true; result: AgentSolanaRegistrationResult }
  | {
      ok: false;
      reason: "needs_funding" | "no_wallet" | "already_registered" | "unavailable" | "error";
      message: string;
    };
