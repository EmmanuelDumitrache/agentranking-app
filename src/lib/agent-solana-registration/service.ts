import "server-only";

import { PublicKey } from "@solana/web3.js";
import { PDAHelpers, SolanaSDK } from "8004-solana";
import { prisma } from "@/lib/db";
import { loadAgentCustodialKeypair } from "@/lib/custodial-wallet/sign-launch";
import { getAgentLaunchSolBalanceLamports, getAgentLaunchNetwork, SOLANA_RPC_BUSY_MESSAGE } from "@/lib/agent-launch/solana";
import { resolveMetaplexRpcUrl } from "@/lib/metaplex/rpc-config";
import {
  AR_AGENT_IDENTITY_PROGRAM_ID,
  AR_AGENT_IDENTITY_REGISTRY_SOURCE,
} from "@/lib/agent-identity-registry/constants";
import {
  registerArAgentIdentity,
  tryReadArAgentIdentityPda,
} from "@/lib/agent-identity-registry/client";
import {
  SOLANA_8004_MAINNET_PROGRAM_ID,
  SOLANA_8004_REGISTRY_SOURCE,
} from "@/lib/solana-8004/constants";
import {
  SOLANA_REGISTRATION_MIN_BALANCE_LAMPORTS,
  SOLANA_REGISTRATION_NETWORK_FEE_LABEL,
} from "@/lib/agent-solana-registration/constants";
import {
  canonicalAgentProfileUrl,
  canonicalRegistrationFileUrl,
} from "@/lib/agent-solana-registration/registration-file";
import { resolveUploadPublicUrl } from "@/lib/public-media-url";
import { isAgentRankingNativeAgent } from "@/lib/dashboard/native-agent";
import type {
  AgentSolanaRegistrationOrigin,
  AgentSolanaRegistrationPageData,
  AgentSolanaRegistrationResult,
  AgentSolanaRegistrationStatus,
  TryRegisterAgentResult,
} from "@/lib/agent-solana-registration/types";

const LAMPORTS_PER_SOL = 1_000_000_000;

function lamportsToSol(lamports: number): number {
  return lamports / LAMPORTS_PER_SOL;
}

function isSolanaPublicKey(value: string | null | undefined): value is string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return false;
  try {
    new PublicKey(trimmed);
    return true;
  } catch {
    return false;
  }
}

function createRegistrySdk(signer: NonNullable<Awaited<ReturnType<typeof loadAgentCustodialKeypair>>>) {
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

async function readOnChainRegistration(assetAddress: string): Promise<boolean> {
  const { Keypair } = await import("@solana/web3.js");
  const sdk = createRegistrySdk(Keypair.generate());
  const asset = new PublicKey(assetAddress);
  const agent = await sdk.getAgent(asset);
  return Boolean(agent);
}

function membershipTx(raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const candidate = (raw as Record<string, unknown>).registrationTx;
  return typeof candidate === "string" && candidate.trim() ? candidate : null;
}

async function resolveDirectoryRegistration(agent: {
  id: number;
  solanaAssetAddress: string | null;
  solanaTransactionSignature: string | null;
}): Promise<{
  assetAddress: string | null;
  transactionSignature: string | null;
  registeredAt: string | null;
}> {
  const membership = await prisma.solanaRegistryMembership.findFirst({
    where: {
      agentDbId: agent.id,
      source: SOLANA_8004_REGISTRY_SOURCE,
      isCurrent: true,
    },
    orderBy: { lastSeenAt: "desc" },
    select: {
      externalId: true,
      firstSeenAt: true,
      rawData: true,
    },
  });

  if (membership?.externalId) {
    return {
      assetAddress: membership.externalId,
      transactionSignature: membershipTx(membership.rawData),
      registeredAt: membership.firstSeenAt.toISOString(),
    };
  }

  if (isSolanaPublicKey(agent.solanaAssetAddress)) {
    return {
      assetAddress: agent.solanaAssetAddress,
      transactionSignature: agent.solanaTransactionSignature,
      registeredAt: null,
    };
  }

  const launch = await prisma.metaplexLaunchAttempt.findFirst({
    where: { agentDbId: agent.id, assetAddress: { not: null } },
    orderBy: { updatedAt: "desc" },
    select: { assetAddress: true },
  });
  if (!launch?.assetAddress) {
    return { assetAddress: null, transactionSignature: null, registeredAt: null };
  }

  const onChain = await readOnChainRegistration(launch.assetAddress);
  if (!onChain) {
    return { assetAddress: null, transactionSignature: null, registeredAt: null };
  }

  return {
    assetAddress: launch.assetAddress,
    transactionSignature: null,
    registeredAt: null,
  };
}

function resolveImportedOnChain(agent: {
  sapAgentPda: string | null;
  metaplexAssetAddress: string | null;
  metaplexAgentIdentityPda: string | null;
}): { kind: "sap" | "metaplex"; address: string } | null {
  if (isSolanaPublicKey(agent.sapAgentPda)) {
    return { kind: "sap", address: agent.sapAgentPda };
  }
  if (isSolanaPublicKey(agent.metaplexAssetAddress)) {
    return { kind: "metaplex", address: agent.metaplexAssetAddress };
  }
  if (isSolanaPublicKey(agent.metaplexAgentIdentityPda)) {
    return { kind: "metaplex", address: agent.metaplexAgentIdentityPda };
  }
  return null;
}

function resolveOrigin(agent: {
  listingRegistrySource: string;
  chainId: number;
  metadata: { key: string; value: string }[];
}): AgentSolanaRegistrationOrigin {
  const importStatus = agent.metadata.find((row) => row.key === "dashboardImportStatus")?.value;
  if (importStatus === "imported" || importStatus === "pending_verification") {
    return "imported";
  }
  return isAgentRankingNativeAgent(agent) ? "created" : "imported";
}

async function resolveArIdentityRegistration(agentDbId: number): Promise<{
  identityPda: string | null;
  transactionSignature: string | null;
}> {
  const membership = await prisma.solanaRegistryMembership.findFirst({
    where: {
      agentDbId,
      source: AR_AGENT_IDENTITY_REGISTRY_SOURCE,
      isCurrent: true,
    },
    orderBy: { lastSeenAt: "desc" },
    select: { externalId: true, rawData: true },
  });
  if (membership?.externalId) {
    return {
      identityPda: membership.externalId,
      transactionSignature: membershipTx(membership.rawData),
    };
  }
  return { identityPda: null, transactionSignature: null };
}

async function resolveAgentTokenMint(agentDbId: number): Promise<string | null> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentDbId },
    select: {
      tokenAddress: true,
      metaplexAgentTokenMint: true,
    },
  });
  const fromAgent = [agent?.metaplexAgentTokenMint, agent?.tokenAddress].find(isSolanaPublicKey);
  if (fromAgent) return fromAgent;

  const launch = await prisma.agentLaunch.findFirst({
    where: { agentDbId, mint: { not: null } },
    orderBy: { updatedAt: "desc" },
    select: { mint: true },
  });
  if (isSolanaPublicKey(launch?.mint)) return launch.mint;

  const attempt = await prisma.metaplexLaunchAttempt.findFirst({
    where: { agentDbId, tokenMint: { not: null } },
    orderBy: { updatedAt: "desc" },
    select: { tokenMint: true },
  });
  return isSolanaPublicKey(attempt?.tokenMint) ? attempt.tokenMint : null;
}

async function loadAgentWallet(agentDbId: number): Promise<{
  publicKey: string | null;
  balanceLamports: number | null;
}> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentDbId },
    select: {
      agentWallet: { select: { publicKey: true } },
    },
  });
  const publicKey = agent?.agentWallet?.publicKey?.trim() ?? null;
  if (!publicKey) {
    return { publicKey: null, balanceLamports: null };
  }
  try {
    const balanceLamports = await getAgentLaunchSolBalanceLamports(new PublicKey(publicKey));
    return { publicKey, balanceLamports };
  } catch {
    return { publicKey, balanceLamports: null };
  }
}

function deriveDirectoryPda(assetAddress: string): string {
  const programId = new PublicKey(SOLANA_8004_MAINNET_PROGRAM_ID);
  const asset = new PublicKey(assetAddress);
  const [agentPda] = PDAHelpers.getAgentPDA(asset, programId);
  return agentPda.toBase58();
}

function resolveStatus(input: {
  registered: boolean;
  walletPublicKey: string | null;
  balanceLamports: number | null;
}): AgentSolanaRegistrationStatus {
  if (input.registered) return "registered";
  if (!input.walletPublicKey) return "no_wallet";
  if (
    input.balanceLamports != null &&
    input.balanceLamports < SOLANA_REGISTRATION_MIN_BALANCE_LAMPORTS
  ) {
    return "insufficient_balance";
  }
  return "not_registered";
}

export async function loadAgentSolanaRegistrationPageData(
  agentDbId: number,
): Promise<AgentSolanaRegistrationPageData | null> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentDbId, isActive: true },
    select: {
      id: true,
      name: true,
      description: true,
      image: true,
      chainId: true,
      agentId: true,
      listingRegistrySource: true,
      solanaAssetAddress: true,
      solanaTransactionSignature: true,
      sapAgentPda: true,
      metaplexAssetAddress: true,
      metaplexAgentIdentityPda: true,
      metadata: { select: { key: true, value: true } },
    },
  });
  if (!agent) return null;

  const listingUri = canonicalAgentProfileUrl(agent);
  const registrationFileUri = canonicalRegistrationFileUrl(agent);
  const capabilities = agent.metadata
    .filter((row) => row.key === "capability" && row.value.trim())
    .map((row) => row.value.trim());
  const origin = resolveOrigin(agent);
  const importedOnChain = resolveImportedOnChain(agent);
  const [directory, arIdentity, tokenMint, wallet] = await Promise.all([
    resolveDirectoryRegistration(agent),
    resolveArIdentityRegistration(agentDbId),
    resolveAgentTokenMint(agentDbId),
    loadAgentWallet(agentDbId),
  ]);

  let arIdentityPda = arIdentity.identityPda;
  let chainReadDegraded = false;
  if (!arIdentityPda && tokenMint) {
    const arRead = await tryReadArAgentIdentityPda(tokenMint);
    arIdentityPda = arRead.pda;
    chainReadDegraded = arRead.rpcBusy;
  }

  const directoryListed = Boolean(directory.assetAddress);
  const canStampArIdentity =
    Boolean(tokenMint) && !arIdentityPda && !chainReadDegraded;
  const mainnetOnly = getAgentLaunchNetwork() !== "mainnet-beta";
  const status = mainnetOnly
    ? "unavailable"
    : resolveStatus({
        registered: directoryListed,
        walletPublicKey: wallet.publicKey,
        balanceLamports: wallet.balanceLamports,
      });

  const registration =
    directoryListed || importedOnChain || arIdentityPda
      ? {
          source: directoryListed ? ("public_directory" as const) : ("imported" as const),
          directoryAsset: directory.assetAddress,
          directoryPda: directory.assetAddress ? deriveDirectoryPda(directory.assetAddress) : null,
          directoryTx: directory.transactionSignature,
          importedAddress: importedOnChain && !directoryListed ? importedOnChain.address : null,
          importedKind: importedOnChain && !directoryListed ? importedOnChain.kind : null,
          arIdentityPda,
          arIdentityTx: arIdentity.transactionSignature,
          registeredAt: directory.registeredAt,
        }
      : null;

  return {
    agentDbId: agent.id,
    agentName: agent.name?.trim() || `Agent ${agent.id}`,
    agentImage: agent.image?.trim() || "",
    agentDescription: agent.description?.trim() || "",
    capabilities,
    origin,
    status,
    walletPublicKey: wallet.publicKey,
    walletBalanceSol:
      wallet.balanceLamports != null ? lamportsToSol(wallet.balanceLamports) : null,
    requiredBalanceSol: lamportsToSol(SOLANA_REGISTRATION_MIN_BALANCE_LAMPORTS),
    networkFeeLabel: SOLANA_REGISTRATION_NETWORK_FEE_LABEL,
    listingUri,
    registrationFileUri,
    tokenMint,
    canStampArIdentity: !mainnetOnly && canStampArIdentity && Boolean(wallet.publicKey),
    canListPublicDirectory: !mainnetOnly && !directoryListed,
    registry: {
      identityProgramId: AR_AGENT_IDENTITY_PROGRAM_ID,
      directoryProgramId: SOLANA_8004_MAINNET_PROGRAM_ID,
      network: "Solana mainnet",
    },
    registration,
    chainReadDegraded: chainReadDegraded || undefined,
  };
}

async function recordMembership(input: {
  agentDbId: number;
  source: string;
  registryAddress: string;
  externalId: string;
  transactionSignature: string;
  extra?: Record<string, unknown>;
}): Promise<void> {
  const now = new Date();
  const generation = BigInt(Date.now());
  await prisma.solanaRegistryMembership.upsert({
    where: {
      source_externalId: {
        source: input.source,
        externalId: input.externalId,
      },
    },
    create: {
      source: input.source,
      externalId: input.externalId,
      registryAddress: input.registryAddress,
      agentDbId: input.agentDbId,
      isCurrent: true,
      sourceActive: true,
      lastSeenGeneration: generation,
      rawData: {
        registrationTx: input.transactionSignature,
        registeredVia: "dashboard",
        ...input.extra,
      },
      firstSeenAt: now,
      lastSeenAt: now,
    },
    update: {
      agentDbId: input.agentDbId,
      isCurrent: true,
      sourceActive: true,
      lastSeenGeneration: generation,
      rawData: {
        registrationTx: input.transactionSignature,
        registeredVia: "dashboard",
        ...input.extra,
      },
      lastSeenAt: now,
    },
  });
}

async function registerPublicDirectoryListing(input: {
  agentDbId: number;
  signer: NonNullable<Awaited<ReturnType<typeof loadAgentCustodialKeypair>>>;
  registrationFileUri: string;
}): Promise<{ assetAddress: string; transactionSignature: string; agentPda: string }> {
  const sdk = createRegistrySdk(input.signer);
  let result: Awaited<ReturnType<SolanaSDK["registerAgent"]>>;
  try {
    result = await sdk.registerAgent(input.registrationFileUri, { atomEnabled: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/insufficient|lamports|balance/i.test(message)) {
      throw new Error(
        `Agent wallet needs at least ${lamportsToSol(SOLANA_REGISTRATION_MIN_BALANCE_LAMPORTS).toFixed(2)} SOL for registration`,
      );
    }
    throw error;
  }
  if ("transaction" in result) {
    throw new Error("Registration returned an unsigned transaction");
  }
  if (!result.asset || !result.signature) {
    throw new Error("Registration did not return an on-chain listing");
  }
  const assetAddress = result.asset.toBase58();
  await recordMembership({
    agentDbId: input.agentDbId,
    source: SOLANA_8004_REGISTRY_SOURCE,
    registryAddress: SOLANA_8004_MAINNET_PROGRAM_ID,
    externalId: assetAddress,
    transactionSignature: result.signature,
    extra: { assetAddress, listingUri: input.registrationFileUri },
  });
  await persistDirectoryListingOnAgent(input.agentDbId, assetAddress, result.signature);
  return {
    assetAddress,
    transactionSignature: result.signature,
    agentPda: deriveDirectoryPda(assetAddress),
  };
}

async function persistDirectoryListingOnAgent(
  agentDbId: number,
  assetAddress: string,
  transactionSignature: string,
): Promise<void> {
  try {
    await prisma.agent.update({
      where: { id: agentDbId },
      data: {
        solanaAssetAddress: assetAddress,
        solanaTransactionSignature: transactionSignature,
        solanaCanonicalStatus: "registered",
        solanaIndexerUpdatedAt: new Date(),
      },
    });
  } catch (error) {
    console.warn("[solana-registration] could not persist directory listing on agent", {
      agentDbId,
      assetAddress,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function stampArIdentity(input: {
  agentDbId: number;
  signer: NonNullable<Awaited<ReturnType<typeof loadAgentCustodialKeypair>>>;
  tokenMint: string;
  agentId: string;
  listingUri: string;
  imageUri: string;
  metadataUri: string;
}): Promise<{ identityPda: string; transactionSignature: string | null }> {
  const arResult = await registerArAgentIdentity({
    signer: input.signer,
    tokenMint: input.tokenMint,
    agentId: input.agentId,
    uri: input.listingUri,
    imageUri: input.imageUri,
    metadataUri: input.metadataUri,
  });
  if (arResult.transactionSignature) {
    await recordMembership({
      agentDbId: input.agentDbId,
      source: AR_AGENT_IDENTITY_REGISTRY_SOURCE,
      registryAddress: AR_AGENT_IDENTITY_PROGRAM_ID,
      externalId: arResult.identityPda,
      transactionSignature: arResult.transactionSignature,
      extra: {
        identityPda: arResult.identityPda,
        tokenMint: arResult.tokenMint,
        listingUri: input.listingUri,
      },
    });
  }
  return {
    identityPda: arResult.identityPda,
    transactionSignature: arResult.transactionSignature || null,
  };
}

export async function registerAgentOnSolana(
  agentDbId: number,
): Promise<AgentSolanaRegistrationResult> {
  if (getAgentLaunchNetwork() !== "mainnet-beta") {
    throw new Error("Solana registration is only available on mainnet");
  }

  const agent = await prisma.agent.findUnique({
    where: { id: agentDbId, isActive: true },
    select: {
      id: true,
      name: true,
      chainId: true,
      agentId: true,
      image: true,
      solanaAssetAddress: true,
      solanaTransactionSignature: true,
    },
  });
  if (!agent) {
    throw new Error("Agent not found");
  }

  const listingUri = canonicalAgentProfileUrl(agent);
  const registrationFileUri = canonicalRegistrationFileUrl(agent);
  const existingDirectory = await resolveDirectoryRegistration(agent);
  const existingAr = await resolveArIdentityRegistration(agentDbId);
  const tokenMint = await resolveAgentTokenMint(agentDbId);
  const arRead = tokenMint ? await tryReadArAgentIdentityPda(tokenMint) : { pda: null, rpcBusy: false };
  if (arRead.rpcBusy && tokenMint && !existingAr.identityPda) {
    throw new Error(SOLANA_RPC_BUSY_MESSAGE);
  }
  const onChainArPda = arRead.pda;
  const arAlreadyDone = Boolean(existingAr.identityPda || onChainArPda);

  if (existingDirectory.assetAddress && (!tokenMint || arAlreadyDone)) {
    throw new Error("This agent is already registered on Solana");
  }

  const keypair = await loadAgentCustodialKeypair(agentDbId);
  if (!keypair) {
    throw new Error("This agent does not have a custodial Solana wallet yet");
  }

  const balanceLamports = await getAgentLaunchSolBalanceLamports(keypair.publicKey);
  if (balanceLamports < SOLANA_REGISTRATION_MIN_BALANCE_LAMPORTS) {
    throw new Error(
      `Agent wallet needs at least ${lamportsToSol(SOLANA_REGISTRATION_MIN_BALANCE_LAMPORTS).toFixed(2)} SOL for registration`,
    );
  }

  let directoryAsset = existingDirectory.assetAddress;
  let directoryTx = existingDirectory.transactionSignature;
  let directoryPda = directoryAsset ? deriveDirectoryPda(directoryAsset) : null;
  if (!directoryAsset) {
    const listed = await registerPublicDirectoryListing({
      agentDbId,
      signer: keypair,
      registrationFileUri,
    });
    directoryAsset = listed.assetAddress;
    directoryTx = listed.transactionSignature;
    directoryPda = listed.agentPda;
  }

  let arIdentityPda = existingAr.identityPda || onChainArPda;
  let arIdentityTx = existingAr.transactionSignature;
  if (tokenMint && !arIdentityPda) {
    const stamped = await stampArIdentity({
      agentDbId,
      signer: keypair,
      tokenMint,
      agentId: `ar-${agent.chainId}-${agent.agentId}`,
      listingUri,
      imageUri: resolveUploadPublicUrl(agent.image),
      metadataUri: registrationFileUri,
    });
    arIdentityPda = stamped.identityPda;
    arIdentityTx = stamped.transactionSignature;
  }

  return {
    directoryAsset,
    directoryPda,
    directoryTx,
    arIdentityPda,
    arIdentityTx,
    listingUri,
    registrationFileUri,
  };
}

export async function tryRegisterAgentOnSolana(agentDbId: number): Promise<TryRegisterAgentResult> {
  try {
    const page = await loadAgentSolanaRegistrationPageData(agentDbId);
    if (!page) {
      return { ok: false, reason: "error", message: "Agent not found" };
    }
    if (page.status === "unavailable") {
      return { ok: false, reason: "unavailable", message: "Solana registration is only available on mainnet" };
    }
    if (!page.canListPublicDirectory && !page.canStampArIdentity) {
      return { ok: false, reason: "already_registered", message: "This agent is already registered on Solana" };
    }
    if (page.status === "no_wallet") {
      return { ok: false, reason: "no_wallet", message: "This agent does not have a custodial Solana wallet yet" };
    }
    if (page.status === "insufficient_balance") {
      return {
        ok: false,
        reason: "needs_funding",
        message: `Agent wallet needs at least ${page.requiredBalanceSol.toFixed(2)} SOL for registration`,
      };
    }
    const result = await registerAgentOnSolana(agentDbId);
    return { ok: true, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/already registered/i.test(message)) {
      return { ok: false, reason: "already_registered", message };
    }
    if (/needs at least|insufficient|lamports|balance/i.test(message)) {
      return { ok: false, reason: "needs_funding", message };
    }
    if (/does not have a custodial/i.test(message)) {
      return { ok: false, reason: "no_wallet", message };
    }
    if (/only available on mainnet/i.test(message)) {
      return { ok: false, reason: "unavailable", message };
    }
    return { ok: false, reason: "error", message };
  }
}

