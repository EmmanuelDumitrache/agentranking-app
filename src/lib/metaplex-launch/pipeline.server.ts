import "server-only";
import { createGenericFile, publicKey, unwrapOption } from "@metaplex-foundation/umi";
import { base58 } from "@metaplex-foundation/umi/serializers";
import {
  mintAgent,
  signAndSendAgentTransaction,
  type AgentMetadata,
} from "@metaplex-foundation/mpl-agent-registry";
import {
  createLaunch,
  registerLaunch,
  signAndSendLaunchTransactions,
} from "@metaplex-foundation/genesis";
import {
  findAgentIdentityV1Pda,
  safeFetchAgentIdentityV2FromSeeds,
} from "@metaplex-foundation/mpl-agent-registry";
import type { CreateLaunchInput } from "@metaplex-foundation/genesis";
import { loadAgentCustodialKeypair } from "@/lib/custodial-wallet/sign-launch";
import {
  METAPLEX_LAUNCH_REGISTRY_ID,
  parseMetaplexLaunchAttemptStatus,
} from "@/lib/metaplex-launch/constants";
import {
  attachCustodialIdentity,
  agentLaunchNetworkToMetaplexSvm,
  createMetaplexLaunchUmi,
} from "@/lib/metaplex-launch/umi-factory.server";
import type { MetaplexLaunchInputSnapshot } from "@/lib/metaplex-launch/types";
import {
  normalizeIrysGatewayUrl,
  parseMetaplexFirstBuySol,
  truncateMetaplexTokenDescription,
  validateMetaplexIrysImageUrl,
} from "@/lib/metaplex-launch/validation";
import { mapMetaplexLaunchError } from "@/lib/metaplex-launch/errors";
import {
  assertImageBytesMatchDeclaredType,
  safeImageFileName,
  type SupportedImageMimeType,
} from "@/lib/image-upload-validation";
import {
  loadMetaplexLaunchAttemptById,
  patchMetaplexLaunchAttempt,
  updateMetaplexLaunchAttemptStatus,
} from "@/lib/metaplex-launch/attempt-store.server";
import type { MetaplexLaunchAttempt } from "@/generated/prisma/client";
import { withMetaplexAttemptExecutionLease } from "@/lib/metaplex-launch/attempt-execution-lease.server";
import { indexMetaplexAgent } from "../../../services/metaplex-indexer";
import { syncMetaplexAttemptToAgentLaunch } from "@/lib/metaplex-launch/sync-agent-launch.server";
const MAX_INDEX_RETRIES = 3;
const MAX_IRYS_IMAGE_BYTES = 5 * 1024 * 1024;
const IRYS_IMAGE_TYPES = new Set<string>(["image/png", "image/jpeg", "image/webp"]);
function buildAgentMetadata(input: {
  name: string;
  description: string;
  attributionId: string;
  website?: string;
  twitter?: string;
  telegram?: string;
}): AgentMetadata {
  const services: AgentMetadata["services"] = [];
  if (input.website?.trim()) {
    services.push({ name: "website", endpoint: input.website.trim() });
  }
  return {
    type: "agent",
    name: input.name.trim(),
    description: input.description.trim(),
    services,
    registrations: [
      {
        agentId: input.attributionId,
        agentRegistry: METAPLEX_LAUNCH_REGISTRY_ID,
      },
    ],
    supportedTrust: [],
  };
}
function buildCoreMetadataJson(input: {
  name: string;
  description: string;
  imageUri: string;
  imageContentType: SupportedImageMimeType;
  website?: string;
  twitter?: string;
  telegram?: string;
}) {
  return {
    name: input.name.trim(),
    description: input.description.trim(),
    image: input.imageUri,
    external_url: input.website?.trim() || undefined,
    attributes: [],
    properties: {
      category: "image",
      files: [{ uri: input.imageUri, type: input.imageContentType }],
    },
  };
}
export async function uploadBytesToIrys(input: {
  agentDbId: number;
  network: string;
  bytes: Uint8Array;
  fileName: string;
  contentType: string;
}): Promise<{ uri: string; contentType: SupportedImageMimeType }> {
  if (
    input.bytes.byteLength === 0 ||
    input.bytes.byteLength > MAX_IRYS_IMAGE_BYTES
  ) {
    throw new Error("Token image must contain 1 byte to 5 MiB.");
  }
  const verifiedContentType = assertImageBytesMatchDeclaredType(
    input.bytes,
    input.contentType,
    IRYS_IMAGE_TYPES,
  );
  const keypair = await loadAgentCustodialKeypair(input.agentDbId);
  if (!keypair) {
    throw new Error("Agent wallet signing is not available for this agent.");
  }
  let umi = createMetaplexLaunchUmi(input.network);
  umi = attachCustodialIdentity(umi, keypair);
  const file = createGenericFile(
    input.bytes,
    safeImageFileName(input.fileName, verifiedContentType),
    { tags: [{ name: "Content-Type", value: verifiedContentType }] },
  );
  const [uri] = await umi.uploader.upload([file]);
  if (!uri?.trim()) {
    throw new Error("Irys upload did not return a gateway URL.");
  }
  const normalized = normalizeIrysGatewayUrl(uri.trim());
  if (!normalized) {
    throw new Error(
      `Irys upload returned an unsupported URI (${uri.trim()}). Expected https://gateway.irys.xyz/...`,
    );
  }
  return { uri: normalized, contentType: verifiedContentType };
}
export async function uploadJsonToIrys(input: {
  agentDbId: number;
  network: string;
  json: unknown;
}): Promise<string> {
  const keypair = await loadAgentCustodialKeypair(input.agentDbId);
  if (!keypair) {
    throw new Error("Agent wallet signing is not available for this agent.");
  }
  let umi = createMetaplexLaunchUmi(input.network);
  umi = attachCustodialIdentity(umi, keypair);
  const uri = await umi.uploader.uploadJson(input.json);
  if (!uri?.trim()) {
    throw new Error("Irys metadata upload did not return a URI.");
  }
  return uri.trim();
}
export async function runMetaplexMintAgentStage(
  attempt: MetaplexLaunchAttempt,
  snapshot: MetaplexLaunchInputSnapshot,
  signal?: AbortSignal,
): Promise<MetaplexLaunchAttempt> {
  assertExecutionLease(signal);
  if (attempt.assetAddress?.trim()) {
    return attempt;
  }
  const keypair = await loadAgentCustodialKeypair(attempt.agentDbId);
  if (!keypair) {
    throw new Error("Agent wallet signing is not available for this agent.");
  }
  let umi = createMetaplexLaunchUmi(attempt.network);
  umi = attachCustodialIdentity(umi, keypair);
  const svmNetwork = agentLaunchNetworkToMetaplexSvm(attempt.network);
  const imageUri = attempt.imageUri?.trim() || snapshot.tokenImageUrl.trim();
  const coreJson = buildCoreMetadataJson({
    name: snapshot.agentName || snapshot.tokenName,
    description: snapshot.agentDescription || snapshot.tokenDescription,
    imageUri,
    imageContentType: snapshot.tokenImageContentType ?? "image/png",
    website: snapshot.website,
    twitter: snapshot.twitter,
    telegram: snapshot.telegram,
  });
  const metadataUri =
    attempt.metadataUri?.trim() ||
    (await uploadJsonToIrys({
      agentDbId: attempt.agentDbId,
      network: attempt.network,
      json: coreJson,
    }));
  assertExecutionLease(signal);
  await updateMetaplexLaunchAttemptStatus(attempt.id, parseMetaplexLaunchAttemptStatus(attempt.status), "METADATA_READY", {
    metadataUri,
    imageUri,
  });
  assertExecutionLease(signal);
  const mintResult = await mintAgent(umi, {}, {
    wallet: umi.identity.publicKey,
    network: svmNetwork,
    name: (snapshot.agentName || snapshot.tokenName).trim(),
    uri: metadataUri,
    agentMetadata: buildAgentMetadata({
      name: snapshot.agentName || snapshot.tokenName,
      description: snapshot.agentDescription || snapshot.tokenDescription,
      attributionId: attempt.publicAttributionId,
      website: snapshot.website,
      twitter: snapshot.twitter,
      telegram: snapshot.telegram,
    }),
  });
  assertExecutionLease(signal);
  const assetAddress = mintResult.assetAddress;
  const identityPda = findAgentIdentityV1Pda(umi, {
    asset: publicKey(assetAddress),
  })[0];
  await updateMetaplexLaunchAttemptStatus(
    attempt.id,
    "METADATA_READY",
    "AGENT_TRANSACTION_BUILT",
    {
      assetAddress,
      identityPda: identityPda.toString(),
      metadataUri,
      imageUri,
      agentTxSignature: null,
    },
  );
  // Persist the expected deterministic asset before the irreversible network
  // submission. A crash after this transition can be reconciled on-chain and
  // must never fall back to minting a second agent.
  await updateMetaplexLaunchAttemptStatus(
    attempt.id,
    "AGENT_TRANSACTION_BUILT",
    "AGENT_SUBMITTED",
  );
  assertExecutionLease(signal);
  const signature = await signAndSendAgentTransaction(umi, mintResult);
  assertExecutionLease(signal);
  const agentTxSignature = base58.deserialize(signature)[0];
  await updateMetaplexLaunchAttemptStatus(
    attempt.id,
    "AGENT_SUBMITTED",
    "AGENT_CONFIRMED",
    { agentTxSignature },
  );
  return updateMetaplexLaunchAttemptStatus(
    attempt.id,
    "AGENT_CONFIRMED",
    "AGENT_REGISTERED",
    { agentTxSignature },
  );
}
export async function verifyAgentHasNoBoundToken(
  attempt: MetaplexLaunchAttempt,
): Promise<void> {
  const asset = attempt.assetAddress?.trim();
  if (!asset) return;
  const keypair = await loadAgentCustodialKeypair(attempt.agentDbId);
  if (!keypair) {
    throw new Error("Agent wallet signing is not available for this agent.");
  }
  let umi = createMetaplexLaunchUmi(attempt.network);
  umi = attachCustodialIdentity(umi, keypair);
  const identity = await safeFetchAgentIdentityV2FromSeeds(umi, {
    asset: publicKey(asset),
  });
  const boundToken = identity ? unwrapOption(identity.agentToken) : null;
  if (boundToken) {
    throw new Error("This Metaplex agent already has a permanently bound token.");
  }
}
function buildGenesisCreateLaunchInput(input: {
  wallet: CreateLaunchInput["wallet"];
  network: NonNullable<CreateLaunchInput["network"]>;
  assetAddress: string;
  snapshot: MetaplexLaunchInputSnapshot;
  imageUri: string;
}): CreateLaunchInput {
  const firstBuyAmount = parseMetaplexFirstBuySol(input.snapshot.firstBuySol);
  const externalLinks: { website?: string; twitter?: string; telegram?: string } = {};
  if (input.snapshot.website?.trim()) externalLinks.website = input.snapshot.website.trim();
  if (input.snapshot.twitter?.trim()) externalLinks.twitter = input.snapshot.twitter.trim();
  if (input.snapshot.telegram?.trim()) externalLinks.telegram = input.snapshot.telegram.trim();
  return {
    wallet: input.wallet,
    network: input.network,
    launchType: "bondingCurve",
    token: {
      name: input.snapshot.tokenName.trim(),
      symbol: input.snapshot.tokenSymbol.trim().toUpperCase(),
      image: input.imageUri,
      description: truncateMetaplexTokenDescription(input.snapshot.tokenDescription),
      externalLinks: Object.keys(externalLinks).length > 0 ? externalLinks : undefined,
    },
    agent: {
      mint: input.assetAddress,
      setToken: true,
    },
    launch: firstBuyAmount > 0 ? { firstBuyAmount } : {},
  };
}
async function registerGenesisLaunch(input: {
  umi: Parameters<typeof registerLaunch>[0];
  attemptId: string;
  genesisAccount: string;
  createLaunchInput: CreateLaunchInput;
  tokenMint?: string | null;
  genesisTxSignatures?: string[];
  expectedStatus: "GENESIS_ONCHAIN_CONFIRMED";
  signal?: AbortSignal;
}): Promise<MetaplexLaunchAttempt> {
  assertExecutionLease(input.signal);
  let registered;
  try {
    registered = await registerLaunch(input.umi, {}, {
      genesisAccount: input.genesisAccount,
      createLaunchInput: input.createLaunchInput,
    });
    assertExecutionLease(input.signal);
  } catch (err) {
    const mapped = mapMetaplexLaunchError(err);
    if (mapped.code !== "metaplex_api_server") {
      throw err;
    }
    assertExecutionLease(input.signal);
    registered = await registerLaunch(input.umi, {}, {
      genesisAccount: input.genesisAccount,
      createLaunchInput: input.createLaunchInput,
    });
    assertExecutionLease(input.signal);
  }
  return updateMetaplexLaunchAttemptStatus(
    input.attemptId,
    input.expectedStatus,
    "GENESIS_REGISTERED",
    {
      genesisAddress: input.genesisAccount,
      tokenMint: input.tokenMint ?? registered.token?.mintAddress ?? null,
      metaplexLaunchUrl: registered.launch?.link ?? null,
      ...(input.genesisTxSignatures
        ? { genesisTxSignatures: input.genesisTxSignatures }
        : {}),
      errorCode: null,
      errorMessage: null,
    },
  );
}
export async function runMetaplexGenesisLaunchStage(
  attempt: MetaplexLaunchAttempt,
  snapshot: MetaplexLaunchInputSnapshot,
  signal?: AbortSignal,
): Promise<MetaplexLaunchAttempt> {
  assertExecutionLease(signal);
  if (!attempt.permanentBindConfirmed) {
    throw new Error("Permanent token binding must be confirmed before launch.");
  }
  const assetAddress = attempt.assetAddress?.trim();
  if (!assetAddress) {
    throw new Error("Metaplex Core asset is required before Genesis launch.");
  }
  const keypair = await loadAgentCustodialKeypair(attempt.agentDbId);
  if (!keypair) {
    throw new Error("Agent wallet signing is not available for this agent.");
  }
  let umi = createMetaplexLaunchUmi(attempt.network);
  umi = attachCustodialIdentity(umi, keypair);
  const svmNetwork = agentLaunchNetworkToMetaplexSvm(attempt.network);
  const imageUri = attempt.imageUri?.trim() || snapshot.tokenImageUrl.trim();
  const createLaunchInput = buildGenesisCreateLaunchInput({
    wallet: umi.identity.publicKey,
    network: svmNetwork,
    assetAddress,
    snapshot,
    imageUri,
  });
  const existingGenesis = attempt.genesisAddress?.trim() || "";
  const existingSigs = Array.isArray(attempt.genesisTxSignatures)
    ? attempt.genesisTxSignatures.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    : [];
  const canResumeRegister =
    Boolean(existingGenesis) &&
    existingSigs.length > 0 &&
    ["GENESIS_SUBMITTED", "GENESIS_ONCHAIN_CONFIRMED"].includes(attempt.status);
  if (canResumeRegister) {
    if (attempt.status === "GENESIS_SUBMITTED") {
      await updateMetaplexLaunchAttemptStatus(
        attempt.id,
        "GENESIS_SUBMITTED",
        "GENESIS_ONCHAIN_CONFIRMED",
        { genesisTxSignatures: existingSigs },
      );
    }
    return registerGenesisLaunch({
      umi,
      attemptId: attempt.id,
      genesisAccount: existingGenesis,
      createLaunchInput,
      tokenMint: attempt.tokenMint,
      genesisTxSignatures: existingSigs,
      expectedStatus: "GENESIS_ONCHAIN_CONFIRMED",
      signal,
    });
  }
  if (existingGenesis) {
    throw new Error(
      "Genesis launch creation has uncertain submission state. Automatic recreation is disabled to prevent a duplicate permanent token binding; reconcile the recorded genesis address before retrying.",
    );
  }
  await updateMetaplexLaunchAttemptStatus(
    attempt.id,
    parseMetaplexLaunchAttemptStatus(attempt.status),
    "GENESIS_PREPARED",
    {
      genesisAddress: null,
      tokenMint: null,
      genesisTxSignatures: [],
      errorCode: null,
      errorMessage: null,
    },
  );
  assertExecutionLease(signal);
  const createResult = await createLaunch(umi, {}, createLaunchInput);
  assertExecutionLease(signal);
  await updateMetaplexLaunchAttemptStatus(
    attempt.id,
    "GENESIS_PREPARED",
    "GENESIS_SUBMITTED",
    {
      genesisAddress: createResult.genesisAccount,
      tokenMint: createResult.mintAddress ?? null,
    },
  );
  assertExecutionLease(signal);
  const signatures = await signAndSendLaunchTransactions(umi, createResult);
  assertExecutionLease(signal);
  const genesisTxSignatures = signatures.map((sig) => base58.deserialize(sig)[0]);
  await updateMetaplexLaunchAttemptStatus(
    attempt.id,
    "GENESIS_SUBMITTED",
    "GENESIS_ONCHAIN_CONFIRMED",
    {
      genesisAddress: createResult.genesisAccount,
      tokenMint: createResult.mintAddress ?? null,
      genesisTxSignatures,
    },
  );
  return registerGenesisLaunch({
    umi,
    attemptId: attempt.id,
    genesisAccount: createResult.genesisAccount,
    createLaunchInput,
    tokenMint: createResult.mintAddress,
    genesisTxSignatures,
    expectedStatus: "GENESIS_ONCHAIN_CONFIRMED",
    signal,
  });
}
export async function runMetaplexIndexStage(
  attempt: MetaplexLaunchAttempt,
  signal?: AbortSignal,
): Promise<MetaplexLaunchAttempt> {
  assertExecutionLease(signal);
  const assetAddress = attempt.assetAddress?.trim();
  if (!assetAddress) {
    throw new Error("Cannot index without Metaplex Core asset address.");
  }
  await updateMetaplexLaunchAttemptStatus(
    attempt.id,
    parseMetaplexLaunchAttemptStatus(attempt.status),
    "AR_INDEX_PENDING",
  );
  let lastError: unknown;
  for (let i = 0; i < MAX_INDEX_RETRIES; i++) {
    try {
      assertExecutionLease(signal);
      await indexMetaplexAgent(assetAddress);
      assertExecutionLease(signal);
      const completed = await updateMetaplexLaunchAttemptStatus(
        attempt.id,
        "AR_INDEX_PENDING",
        "COMPLETE",
        {
          completedAt: new Date(),
          errorCode: null,
          errorMessage: null,
        },
      );
      await syncMetaplexAttemptToAgentLaunch(completed);
      return completed;
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
      assertExecutionLease(signal);
    }
  }
  const mapped = mapMetaplexLaunchError(lastError);
  return patchMetaplexLaunchAttempt(attempt.id, {
    status: "AR_INDEX_PENDING",
    errorCode: mapped.code,
    errorMessage: mapped.message,
  });
}
async function agentIdentityExists(attempt: MetaplexLaunchAttempt): Promise<boolean> {
  const asset = attempt.assetAddress?.trim();
  if (!asset) return false;
  const keypair = await loadAgentCustodialKeypair(attempt.agentDbId);
  if (!keypair) {
    throw new Error("Agent wallet signing is not available for this agent.");
  }
  let umi = createMetaplexLaunchUmi(attempt.network);
  umi = attachCustodialIdentity(umi, keypair);
  const identity = await safeFetchAgentIdentityV2FromSeeds(umi, {
    asset: publicKey(asset),
  });
  return identity !== null;
}
function uncertainAgentSubmissionError(): Error {
  return new Error(
    "Metaplex agent submission state is uncertain. Automatic remint is disabled to prevent a duplicate agent; retry after the submitted asset becomes visible or reconcile the recorded asset manually.",
  );
}
async function reconcileAgentSubmission(
  attempt: MetaplexLaunchAttempt,
): Promise<MetaplexLaunchAttempt> {
  if (attempt.status === "AGENT_TRANSACTION_BUILT") {
    if (!attempt.assetAddress?.trim()) {
      // Legacy builds did not persist the expected asset before broadcast, so a
      // crash in this state cannot be distinguished from a submitted mint.
      throw uncertainAgentSubmissionError();
    }
    // In the current state machine AGENT_TRANSACTION_BUILT is persisted before
    // AGENT_SUBMITTED and before broadcast. It is therefore safe to rebuild.
    return patchMetaplexLaunchAttempt(attempt.id, {
      status: "METADATA_READY",
      assetAddress: null,
      identityPda: null,
      agentTxSignature: null,
      errorCode: null,
      errorMessage: null,
    });
  }
  if (attempt.status !== "AGENT_SUBMITTED" && attempt.status !== "AGENT_CONFIRMED") {
    return attempt;
  }
  if (!attempt.assetAddress?.trim() || !(await agentIdentityExists(attempt))) {
    throw uncertainAgentSubmissionError();
  }
  let current = attempt;
  if (current.status === "AGENT_SUBMITTED") {
    current = await updateMetaplexLaunchAttemptStatus(
      current.id,
      "AGENT_SUBMITTED",
      "AGENT_CONFIRMED",
    );
  }
  return updateMetaplexLaunchAttemptStatus(
    current.id,
    "AGENT_CONFIRMED",
    "AGENT_REGISTERED",
  );
}
async function recoveryStatusForAttempt(
  attempt: MetaplexLaunchAttempt,
): Promise<"DRAFT" | "METADATA_READY" | "AGENT_REGISTERED" | "GENESIS_ONCHAIN_CONFIRMED"> {
  const signatures = Array.isArray(attempt.genesisTxSignatures)
    ? attempt.genesisTxSignatures.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
  if (attempt.genesisAddress?.trim()) {
    if (signatures.length > 0) return "GENESIS_ONCHAIN_CONFIRMED";
    throw new Error(
      "Genesis launch submission state is uncertain. Automatic recreation is disabled to prevent a duplicate permanent token binding; reconcile the recorded genesis address before retrying.",
    );
  }
  if (attempt.assetAddress?.trim()) {
    if (await agentIdentityExists(attempt)) return "AGENT_REGISTERED";
    throw uncertainAgentSubmissionError();
  }
  if (attempt.metadataUri?.trim()) return "METADATA_READY";
  return "DRAFT";
}
function assertExecutionLease(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error("Metaplex launch execution lease was lost");
  }
}
async function runMetaplexLaunchPipelineUnlocked(
  attempt: MetaplexLaunchAttempt,
  signal: AbortSignal,
): Promise<MetaplexLaunchAttempt> {
  let current = attempt;
  assertExecutionLease(signal);
  if (current.status === "FAILED_RECOVERABLE") {
    current = await patchMetaplexLaunchAttempt(current.id, {
      status: await recoveryStatusForAttempt(current),
      errorCode: null,
      errorMessage: null,
    });
  }
  current = await reconcileAgentSubmission(current);
  let snapshot = (current.inputSnapshot ?? {}) as MetaplexLaunchInputSnapshot;
  const imageCandidate = current.imageUri?.trim() || snapshot.tokenImageUrl?.trim() || "";
  const imageError = validateMetaplexIrysImageUrl(imageCandidate);
  if (imageError) throw new Error(imageError);
  const normalizedImage = normalizeIrysGatewayUrl(imageCandidate);
  if (normalizedImage && normalizedImage !== imageCandidate) {
    current = await patchMetaplexLaunchAttempt(current.id, {
      imageUri: normalizedImage,
      inputSnapshot: { ...snapshot, tokenImageUrl: normalizedImage },
    });
    snapshot = (current.inputSnapshot ?? snapshot) as MetaplexLaunchInputSnapshot;
  }
  assertExecutionLease(signal);
  const needsAgentMint = !current.assetAddress?.trim() && snapshot.path !== "existing_agent";
  if (needsAgentMint && ["DRAFT", "METADATA_READY"].includes(current.status)) {
    current = await runMetaplexMintAgentStage(current, snapshot, signal);
    assertExecutionLease(signal);
  }
  const needsGenesis = [
    "AGENT_REGISTERED",
    "GENESIS_PREPARED",
    "GENESIS_SUBMITTED",
    "GENESIS_ONCHAIN_CONFIRMED",
    "FAILED_RECOVERABLE",
  ].includes(current.status) && !["GENESIS_REGISTERED", "AR_INDEX_PENDING", "COMPLETE"].includes(current.status);
  if (needsGenesis) {
    current = await runMetaplexGenesisLaunchStage(current, snapshot, signal);
    assertExecutionLease(signal);
  }
  if (["GENESIS_REGISTERED", "AR_INDEX_PENDING"].includes(current.status)) {
    current = await runMetaplexIndexStage(current, signal);
    assertExecutionLease(signal);
  }
  return current;
}
export async function runMetaplexLaunchPipelineServer(
  attempt: MetaplexLaunchAttempt,
): Promise<MetaplexLaunchAttempt> {
  return withMetaplexAttemptExecutionLease(attempt.id, async (signal) => {
    const current = await loadMetaplexLaunchAttemptById(attempt.id);
    if (!current) throw new Error(`Metaplex launch attempt not found: ${attempt.id}`);
    return runMetaplexLaunchPipelineUnlocked(current, signal);
  });
}
