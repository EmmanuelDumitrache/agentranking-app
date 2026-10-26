import "server-only";

import { Buffer } from "node:buffer";
import { Keypair, PublicKey } from "@solana/web3.js";
import { SolanaSDK, PDAHelpers } from "8004-solana";
import type { AccountVerificationLevel } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { loadAgentCustodialKeypair } from "@/lib/custodial-wallet/sign-launch";
import { resolveMetaplexRpcUrl } from "@/lib/metaplex/rpc-config";
import {
  SOLANA_8004_ANCHOR_CHAIN_ID,
  SOLANA_8004_MAINNET_PROGRAM_ID,
  SOLANA_8004_MAINNET_ROOT_CONFIG_PDA,
  SOLANA_8004_MAINNET_REGISTRY_CONFIG_PDA,
  SOLANA_8004_REGISTRY_SOURCE,
} from "@/lib/solana-8004/constants";
import {
  buildVerificationAnchorPayload,
  hashVerificationAnchorPayload,
} from "@/lib/verification/sap-anchor-payload";
import {
  isRegistryVerificationAnchorEnabled,
  loadRegistryAuthorityKeypair,
  resolveCredentialProofUrl,
  VERIFICATION_FEEDBACK_TAG,
} from "@/lib/verification/registry-anchor-config";

export type RegistryAnchorResult =
  | {
      status: "anchored";
      txSignature: string;
      assetAddress: string;
      agentPda: string;
      registryProgram: string;
      rootConfigPda: string;
      registryConfigPda: string;
      registrationTx?: string;
    }
  | { status: "skipped"; reason: string }
  | {
      status: "needs_registration";
      ownerWallet: string;
      agentPda: string;
      requiredSol: number;
    }
  | { status: "error"; message: string };

function createRegistrySdk(signer: Keypair): SolanaSDK {
  return new SolanaSDK({
    cluster: "mainnet-beta",
    rpcUrl: resolveMetaplexRpcUrl(),
    signer,
    useIndexer: false,
    indexerFallback: false,
    forceOnChain: true,
    programIds: {
      agentRegistry: SOLANA_8004_MAINNET_PROGRAM_ID,
    },
  });
}

async function resolveAgentAsset(appAccountId: string): Promise<{
  agentDbId: number;
  agentName: string;
  assetAddress: string | null;
} | null> {
  const agents = await prisma.agent.findMany({
    where: { ownerAccountId: appAccountId, isActive: true },
    orderBy: { id: "asc" },
    select: { id: true, name: true },
  });
  if (agents.length === 0) return null;

  for (const agent of agents) {
    const membership = await prisma.solanaRegistryMembership.findFirst({
      where: {
        agentDbId: agent.id,
        source: SOLANA_8004_REGISTRY_SOURCE,
        isCurrent: true,
      },
      select: { externalId: true },
    });
    if (membership?.externalId) {
      return {
        agentDbId: agent.id,
        agentName: agent.name?.trim() || `Agent ${agent.id}`,
        assetAddress: membership.externalId,
      };
    }

    const launch = await prisma.metaplexLaunchAttempt.findFirst({
      where: { agentDbId: agent.id, assetAddress: { not: null } },
      orderBy: { updatedAt: "desc" },
      select: { assetAddress: true },
    });
    if (launch?.assetAddress) {
      return {
        agentDbId: agent.id,
        agentName: agent.name?.trim() || `Agent ${agent.id}`,
        assetAddress: launch.assetAddress,
      };
    }
  }

  const first = agents[0]!;
  return {
    agentDbId: first.id,
    agentName: first.name?.trim() || `Agent ${first.id}`,
    assetAddress: null,
  };
}

async function ensureAgentRegistered(params: {
  agentDbId: number;
  agentName: string;
  publicId: string;
}): Promise<
  | { ok: true; assetAddress: PublicKey; registrationTx?: string }
  | { ok: false; reason: "needs_registration"; agentPda: string; ownerWallet: string }
  | { ok: false; reason: "error"; message: string }
> {
  const keypair = await loadAgentCustodialKeypair(params.agentDbId);
  if (!keypair) {
    return {
      ok: false,
      reason: "error",
      message: "Agent custodial wallet is required to register in the 8004 registry",
    };
  }

  const sdk = createRegistrySdk(keypair);
  const tokenUri = resolveCredentialProofUrl(params.publicId);

  try {
    const result = await sdk.registerAgent(tokenUri, { atomEnabled: false });
    if ("transaction" in result) {
      return {
        ok: false,
        reason: "error",
        message: "Unexpected unsigned registration transaction",
      };
    }
    if (!result.asset) {
      return { ok: false, reason: "error", message: "Registration did not return asset address" };
    }
    return {
      ok: true,
      assetAddress: result.asset,
      registrationTx: result.signature,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/insufficient|lamports|balance/i.test(message)) {
      return {
        ok: false,
        reason: "needs_registration",
        agentPda: "",
        ownerWallet: keypair.publicKey.toBase58(),
      };
    }
    return { ok: false, reason: "error", message };
  }
}

export async function anchorAccountVerificationOnRegistry(params: {
  appAccountId: string;
  publicId: string;
  level: AccountVerificationLevel;
  verifiedAt: Date;
  expiresAt?: Date | null;
  accountVerificationId?: string;
}): Promise<RegistryAnchorResult> {
  if (!isRegistryVerificationAnchorEnabled()) {
    return { status: "skipped", reason: "VERIFICATION_8004_ANCHOR_ENABLED is off" };
  }

  const authority = loadRegistryAuthorityKeypair();
  if (!authority) {
    return {
      status: "skipped",
      reason: "VERIFICATION_REGISTRY_AUTHORITY_SECRET_KEY is not configured",
    };
  }

  const target = await resolveAgentAsset(params.appAccountId);
  if (!target) {
    return { status: "skipped", reason: "No active agent found for this account" };
  }

  const programId = new PublicKey(SOLANA_8004_MAINNET_PROGRAM_ID);
  let assetPk: PublicKey;
  let registrationTx: string | undefined;

  if (target.assetAddress) {
    assetPk = new PublicKey(target.assetAddress);
  } else {
    const registered = await ensureAgentRegistered({
      agentDbId: target.agentDbId,
      agentName: target.agentName,
      publicId: params.publicId,
    });
    if (!registered.ok) {
      if (registered.reason === "needs_registration") {
        return {
          status: "needs_registration",
          ownerWallet: registered.ownerWallet,
          agentPda: "",
          requiredSol: 0.01,
        };
      }
      return { status: "error", message: registered.message };
    }
    assetPk = registered.assetAddress;
    registrationTx = registered.registrationTx;
  }

  const [agentPda] = PDAHelpers.getAgentPDA(assetPk, programId);
  const payload = buildVerificationAnchorPayload({
    publicId: params.publicId,
    level: params.level,
    verifiedAt: params.verifiedAt,
    appAccountId: params.appAccountId,
  });
  const { bytes: metadataHash } = hashVerificationAnchorPayload(payload);
  const feedbackUri = resolveCredentialProofUrl(params.publicId);

  try {
    const sdk = createRegistrySdk(authority);
    const result = await sdk.giveFeedback(assetPk, {
      score: 100,
      value: "1",
      tag1: VERIFICATION_FEEDBACK_TAG,
      tag2: params.level.toLowerCase(),
      endpoint: "/api/verification/credential",
      feedbackUri,
      feedbackFileHash: Buffer.from(metadataHash),
    });

    if ("transaction" in result) {
      return { status: "error", message: "Unexpected unsigned feedback transaction" };
    }

    const txSignature = result.signature;
    const attestationRef = JSON.stringify({
      v: 1,
      program: SOLANA_8004_MAINNET_PROGRAM_ID,
      rootConfigPda: SOLANA_8004_MAINNET_ROOT_CONFIG_PDA,
      registryConfigPda: SOLANA_8004_MAINNET_REGISTRY_CONFIG_PDA,
      asset: assetPk.toBase58(),
      agentPda: agentPda.toBase58(),
      tx: txSignature,
    });

    if (params.accountVerificationId) {
      await prisma.accountVerification.update({
        where: { id: params.accountVerificationId },
        data: {
          attestationUid: attestationRef,
          attestationChainId: SOLANA_8004_ANCHOR_CHAIN_ID,
        },
      });
    } else {
      await prisma.accountVerification.updateMany({
        where: {
          appAccountId: params.appAccountId,
          status: "VERIFIED",
          attestationUid: null,
        },
        data: {
          attestationUid: attestationRef,
          attestationChainId: SOLANA_8004_ANCHOR_CHAIN_ID,
        },
      });
    }

    return {
      status: "anchored",
      txSignature,
      assetAddress: assetPk.toBase58(),
      agentPda: agentPda.toBase58(),
      registryProgram: SOLANA_8004_MAINNET_PROGRAM_ID,
      rootConfigPda: SOLANA_8004_MAINNET_ROOT_CONFIG_PDA,
      registryConfigPda: SOLANA_8004_MAINNET_REGISTRY_CONFIG_PDA,
      registrationTx,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: "error", message };
  }
}

export async function getRegistryAnchorStatus(appAccountId: string): Promise<{
  enabled: boolean;
  authorityConfigured: boolean;
  registry: {
    programId: string;
    rootConfigPda: string;
    registryConfigPda: string;
  };
  agent: {
    agentDbId: number;
    assetAddress: string | null;
    agentPda: string | null;
    registered: boolean;
  } | null;
  attestation: { ref: string | null; chainId: string | null; txSignature: string | null } | null;
}> {
  const enabled = isRegistryVerificationAnchorEnabled();
  const authorityConfigured = Boolean(loadRegistryAuthorityKeypair());
  const target = await resolveAgentAsset(appAccountId);

  const latest = await prisma.accountVerification.findFirst({
    where: { appAccountId, status: "VERIFIED" },
    orderBy: { createdAt: "desc" },
    select: { attestationUid: true, attestationChainId: true },
  });

  let txSignature: string | null = null;
  if (latest?.attestationUid) {
    try {
      const parsed = JSON.parse(latest.attestationUid) as { tx?: string };
      txSignature = parsed.tx ?? latest.attestationUid;
    } catch {
      txSignature = latest.attestationUid;
    }
  }

  let agentPda: string | null = null;
  let registered = false;
  if (target?.assetAddress) {
    try {
      const programId = new PublicKey(SOLANA_8004_MAINNET_PROGRAM_ID);
      const asset = new PublicKey(target.assetAddress);
      agentPda = PDAHelpers.getAgentPDA(asset, programId)[0].toBase58();
      const sdk = createRegistrySdk(Keypair.generate());
      const agent = await sdk.getAgent(asset);
      registered = Boolean(agent);
    } catch {
      registered = false;
    }
  }

  return {
    enabled,
    authorityConfigured,
    registry: {
      programId: SOLANA_8004_MAINNET_PROGRAM_ID,
      rootConfigPda: SOLANA_8004_MAINNET_ROOT_CONFIG_PDA,
      registryConfigPda: SOLANA_8004_MAINNET_REGISTRY_CONFIG_PDA,
    },
    agent: target
      ? {
          agentDbId: target.agentDbId,
          assetAddress: target.assetAddress,
          agentPda,
          registered,
        }
      : null,
    attestation: latest
      ? {
          ref: latest.attestationUid,
          chainId: latest.attestationChainId,
          txSignature,
        }
      : null,
  };
}

