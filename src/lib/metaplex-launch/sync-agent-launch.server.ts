import "server-only";
import type { MetaplexLaunchAttempt } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { agentLaunchLinkageForCreate } from "@/lib/agent-launch/agent-db-id";
import { getAgentLaunchConfig } from "@/lib/agent-launch/config";
import { recordAgentLaunchEvent } from "@/lib/agent-launch/events";
import type { MetaplexLaunchInputSnapshot } from "@/lib/metaplex-launch/types";
import { buildTokenLaunchFeedEvent } from "@/lib/public-site/ar-live-feed-builders.server";
import { publishArLiveFeedEvent } from "@/lib/public-site/ar-live-feed-publish.server";
function snapshotCreatorWallet(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const raw = (snapshot as { creatorWallet?: unknown }).creatorWallet;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}
/** Mirror a completed Metaplex Genesis attempt into agent_launches for /tokens discovery. */
export async function syncMetaplexAttemptToAgentLaunch(
  attempt: MetaplexLaunchAttempt,
): Promise<string | null> {
  const mint = attempt.tokenMint?.trim();
  if (!mint) return null;
  const snapshot = (attempt.inputSnapshot ?? {}) as MetaplexLaunchInputSnapshot;
  const config = getAgentLaunchConfig();
  const creatorWallet = snapshotCreatorWallet(snapshot);
  const genesisTxSignature = attempt.genesisTxSignature?.trim() || null;
  const launchData = {
    mint,
    creatorWallet,
    network: attempt.network,
    arTreasuryWallet: config.treasury,
    creationFeeLamports: config.creationFeeLamports,
    creatorShareBps: config.creatorShareBps,
    arShareBps: config.arShareBps,
    tokenName: snapshot.tokenName?.trim() || snapshot.agentName?.trim() || null,
    tokenSymbol: snapshot.tokenSymbol?.trim() || null,
    tokenDescription: snapshot.tokenDescription?.trim() || snapshot.agentDescription?.trim() || null,
    tokenImageUrl: snapshot.tokenImageUrl?.trim() || attempt.imageUri?.trim() || null,
    metadataUri: attempt.metadataUri?.trim() || null,
    creationTx: attempt.agentTxSignature?.trim() || null,
    feeShareTx: genesisTxSignature,
    feeSharingStatus: "active",
    launchStatus: "indexed",
    launchKind: "metaplex_genesis",
    launchLifecycleStatus: "live",
    marketSource: "metaplex_genesis",
    profileDisplayName: snapshot.agentName?.trim() || snapshot.tokenName?.trim() || null,
    profileTwitter: snapshot.twitter?.trim() || null,
    profileWebsite: snapshot.website?.trim() || null,
    profileAvatarUrl: snapshot.tokenImageUrl?.trim() || attempt.imageUri?.trim() || null,
  };
  const existingByMint = await prisma.agentLaunch.findUnique({ where: { mint } });
  const launch = existingByMint
    ? await prisma.agentLaunch.update({
        where: { id: existingByMint.id },
        data: {
          ...launchData,
          ...(attempt.agentDbId
            ? {
                agentId: String(attempt.agentDbId),
                linkedAgent: { connect: { id: attempt.agentDbId } },
              }
            : {}),
        },
      })
    : await (async () => {
        const existingByAgent = attempt.agentDbId
          ? await prisma.agentLaunch.findFirst({ where: { agentDbId: attempt.agentDbId } })
          : null;
        if (existingByAgent) {
          return prisma.agentLaunch.update({
            where: { id: existingByAgent.id },
            data: {
              ...launchData,
              agentId: String(attempt.agentDbId),
              linkedAgent: { connect: { id: attempt.agentDbId } },
            },
          });
        }
        return prisma.agentLaunch.create({
          data: {
            ...agentLaunchLinkageForCreate(
              attempt.agentDbId ? String(attempt.agentDbId) : null,
            ),
            ...launchData,
          },
        });
      })();
  if (attempt.agentDbId) {
    await prisma.agent.updateMany({
      where: { id: attempt.agentDbId },
      data: {
        metaplexAgentTokenMint: mint,
        isActive: true,
        listedAt: new Date(),
        lastActiveAt: new Date(),
      },
    });
  }
  await recordAgentLaunchEvent({
    launchId: launch.id,
    type: "fee_share_active",
    txSignature: genesisTxSignature ?? attempt.agentTxSignature ?? undefined,
    payloadJson: {
      source: "metaplex_genesis",
      attemptId: attempt.id,
      genesisAddress: attempt.genesisAddress,
    },
  });
  publishArLiveFeedEvent(
    buildTokenLaunchFeedEvent({
      launchId: launch.id,
      mint,
      tokenSymbol: launch.tokenSymbol,
      tokenName: launch.tokenName,
      profileDisplayName: launch.profileDisplayName,
      createdAt: launch.createdAt,
      chain: "solana",
    }),
  );
  return launch.id;
}
