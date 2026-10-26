import type { MetaplexLaunchAttempt } from "@/generated/prisma/client";
import type {
  MetaplexLaunchInputSnapshot,
  SerializedMetaplexLaunchAttempt,
} from "@/lib/metaplex-launch/types";
import { parseMetaplexLaunchAttemptStatus } from "@/lib/metaplex-launch/constants";
function parseInputSnapshot(raw: unknown): MetaplexLaunchInputSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  return raw as MetaplexLaunchInputSnapshot;
}
export function serializeMetaplexLaunchAttempt(
  row: MetaplexLaunchAttempt,
): SerializedMetaplexLaunchAttempt {
  return {
    id: row.id,
    publicAttributionId: row.publicAttributionId,
    agentDbId: row.agentDbId,
    userProfileId: row.userProfileId,
    walletAddress: row.walletAddress,
    network: row.network,
    status: parseMetaplexLaunchAttemptStatus(row.status),
    inputSnapshot: parseInputSnapshot(row.inputSnapshot),
    imageUri: row.imageUri,
    metadataUri: row.metadataUri,
    assetAddress: row.assetAddress,
    identityPda: row.identityPda,
    tokenMint: row.tokenMint,
    genesisAddress: row.genesisAddress,
    metaplexLaunchUrl: row.metaplexLaunchUrl,
    agentTxSignature: row.agentTxSignature,
    genesisTxSignatures: row.genesisTxSignatures,
    genesisTxSignature: row.genesisTxSignature ?? null,
    arAgentId: row.arAgentId,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    retryCount: row.retryCount,
    permanentBindConfirmed: row.permanentBindConfirmed,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}
