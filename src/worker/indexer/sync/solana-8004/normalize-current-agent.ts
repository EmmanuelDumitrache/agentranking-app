import type { DecodedCoreAsset } from "./hydrate-core-assets.js";
import type { HydratedSolana8004AgentAccount } from "./hydrate-agent-accounts.js";
import { SOLANA_8004_PROTOCOL_IMPLEMENTATION } from "./constants.js";
import { validateRegistrationUri } from "./validation.js";
import { SOLANA_REGISTRY_SOURCE, type CurrentSolanaAgent } from "../solana-current-state-types.js";

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.normalize("NFC").trim() : null;
}

function evidencePart(value: string | null): string {
  return value == null ? "-:" : `${Buffer.byteLength(value, "utf8")}:${value}`;
}

export function normalizeSolana8004CurrentAgent(input: {
  account: HydratedSolana8004AgentAccount;
  coreAsset: DecodedCoreAsset;
  registryAddress: string;
  sourceSlot: bigint;
}): CurrentSolanaAgent {
  const coreOwner = input.coreAsset.owner.toString();
  const coreUri = validateRegistrationUri(optionalText(input.coreAsset.uri));
  const accountUri = validateRegistrationUri(input.account.decoded.agentUri);
  const coreUpdateAuthority = input.coreAsset.updateAuthority?.address?.toString?.() ?? null;
  const raw = {
    protocolImplementation: SOLANA_8004_PROTOCOL_IMPLEMENTATION,
    agentAccountPda: input.account.accountPda,
    collection: input.account.decoded.collection,
    creator: input.account.decoded.creator,
    cachedOwner: input.account.decoded.cachedOwner,
    asset: input.account.decoded.asset,
    bump: input.account.decoded.bump,
    atomEnabled: input.account.decoded.atomEnabled,
    agentWallet: input.account.decoded.agentWallet,
    feedbackDigestHex: input.account.decoded.feedbackDigestHex,
    feedbackCount: input.account.decoded.feedbackCount.toString(10),
    responseDigestHex: input.account.decoded.responseDigestHex,
    responseCount: input.account.decoded.responseCount.toString(10),
    revokeDigestHex: input.account.decoded.revokeDigestHex,
    revokeCount: input.account.decoded.revokeCount.toString(10),
    parentAsset: input.account.decoded.parentAsset,
    parentLocked: input.account.decoded.parentLocked,
    collectionLocked: input.account.decoded.collectionLocked,
    agent_uri: accountUri,
    nft_name: input.account.decoded.nftName,
    col: input.account.decoded.collectionPointer,
    coreOwner,
    coreUri,
    coreUpdateAuthority,
    evidenceDigest: input.account.evidenceDigest,
  };
  return {
    source: SOLANA_REGISTRY_SOURCE.SOLANA_8004,
    externalId: input.account.decoded.asset,
    registryAddress: input.registryAddress,
    assetAddress: input.account.decoded.asset,
    sequenceId: null,
    owner: coreOwner,
    creator: input.account.decoded.creator,
    operationalWallet: input.account.decoded.agentWallet,
    registrationUri: coreUri ?? accountUri,
    sourceActive: true,
    sourceSlot: input.sourceSlot,
    sourceUpdatedAt: null,
    nameHint: optionalText(input.coreAsset.name) ?? optionalText(input.account.decoded.nftName),
    // The account digest covers every registry-account byte. The remaining
    // parts are precisely the Core fields retained in raw evidence. Length
    // prefixes make this collision-free without hashing or JSON serialization.
    sourceEvidenceKey: [
      SOLANA_8004_PROTOCOL_IMPLEMENTATION,
      input.account.evidenceDigest,
      coreOwner,
      coreUri,
      coreUpdateAuthority,
    ].map(evidencePart).join(""),
    raw,
  };
}
