import type { MetaplexLaunchAttemptStatus } from "@/lib/metaplex-launch/constants";
import type { SupportedImageMimeType } from "@/lib/image-upload-validation";
import type { MetaplexLaunchFormFields } from "@/lib/metaplex-launch/validation";
export type MetaplexLaunchInputSnapshot = MetaplexLaunchFormFields & {
  agentName?: string;
  agentDescription?: string;
  agentImageUrl?: string;
  tokenImageContentType?: SupportedImageMimeType;
  path?: "new_agent" | "existing_agent";
};
export type SerializedMetaplexLaunchAttempt = {
  id: string;
  publicAttributionId: string;
  agentDbId: number;
  userProfileId: number | null;
  walletAddress: string;
  network: string;
  status: MetaplexLaunchAttemptStatus;
  inputSnapshot: MetaplexLaunchInputSnapshot | null;
  imageUri: string | null;
  metadataUri: string | null;
  assetAddress: string | null;
  identityPda: string | null;
  tokenMint: string | null;
  genesisAddress: string | null;
  metaplexLaunchUrl: string | null;
  agentTxSignature: string | null;
  genesisTxSignatures: string[];
  /** First genesis transaction signature (native projection of element zero). */
  genesisTxSignature: string | null;
  arAgentId: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  retryCount: number;
  permanentBindConfirmed: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};
export type MetaplexLaunchProgressPhase =
  | "idle"
  | "draft"
  | "upload"
  | "mint_agent"
  | "genesis"
  | "register"
  | "index"
  | "done"
  | "error";
