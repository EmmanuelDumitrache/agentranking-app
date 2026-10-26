import "server-only";

import { prisma } from "@/lib/db";
import {
  toPublicAgentCredential,
  withCredentialProofUrl,
  type PublicAgentCredential,
} from "@/lib/verification/public-agent-credential";

const OWNER_CREDENTIAL_SELECT = {
  publicId: true,
  verificationLevel: true,
  verificationStatus: true,
  verifiedAt: true,
  verificationExpiresAt: true,
} as const;

export { OWNER_CREDENTIAL_SELECT };

export async function loadAgentPublicCredential(
  chainId: number,
  agentId: number,
): Promise<PublicAgentCredential | null> {
  const agent = await prisma.agent.findFirst({
    where: { chainId, agentId, isActive: true },
    select: {
      ownerAccount: { select: OWNER_CREDENTIAL_SELECT },
    },
  });
  if (!agent) return null;
  return toPublicAgentCredential(agent.ownerAccount);
}

export function publicAgentCredentialResponse(
  credential: PublicAgentCredential,
  origin?: string,
) {
  return {
    credential: withCredentialProofUrl(credential, origin),
  };
}
