"use client";

import type { SerializedAgentLaunch } from "@/components/agent-launch/types";
import {
  activatePumpFeeRouting,
  createLaunchDraft,
  createPumpTokenOnChain,
  fetchLaunchDraft,
  patchLaunchDraft,
  publishLaunchMetadata,
  type LaunchProgressPhase,
  type TokenLaunchFormFields,
} from "@/lib/agent-launch/token-launch-client";
import { generateMintKeypair } from "@/lib/agent-launch/wallet-client";
import { isLaunchIndexed } from "@/lib/agent-launch/launch-wizard-state";

export type PublicQuickLaunchChain = "solana" | "robinhood";

export async function runPublicSolanaQuickLaunch(options: {
  creatorWallet: string;
  fields: TokenLaunchFormFields;
  existingLaunchId?: string | null;
  onPhase: (phase: LaunchProgressPhase) => void;
}): Promise<SerializedAgentLaunch> {
  const { creatorWallet, fields, onPhase } = options;
  let launch: SerializedAgentLaunch | null = null;

  if (options.existingLaunchId) {
    const loaded = await fetchLaunchDraft(options.existingLaunchId, creatorWallet);
    launch = loaded.launch;
  }

  if (launch && isLaunchIndexed(launch)) {
    onPhase("done");
    return launch;
  }

  const mintKeypair = generateMintKeypair();

  if (!launch) {
    onPhase("draft");
    launch = await createLaunchDraft("", creatorWallet);
  }

  onPhase("details");
  launch = await patchLaunchDraft(launch.id, {
    creatorWallet,
    tokenName: fields.tokenName,
    tokenSymbol: fields.tokenSymbol,
    tokenDescription: fields.tokenDescription,
    tokenImageUrl: fields.tokenImageUrl,
    website: fields.website,
    twitter: fields.twitter,
    telegram: fields.telegram,
  });

  if (!launch.metadataUri) {
    onPhase("metadata");
    launch = await publishLaunchMetadata(
      launch.id,
      fields.tokenImageUrl.trim(),
      mintKeypair.publicKey.toBase58(),
      fields.twitter?.trim() || null,
      fields.telegram?.trim() || null,
    );
  }

  if (
    launch.launchStatus === "draft" ||
    (launch.launchStatus !== "token_created" &&
      launch.launchStatus !== "fee_share_pending" &&
      launch.launchStatus !== "indexed")
  ) {
    onPhase("preparing");
    onPhase("create");
    launch = await createPumpTokenOnChain(launch, creatorWallet, mintKeypair, 0, onPhase);
  }

  if (!isLaunchIndexed(launch)) {
    onPhase("routing");
    launch = await activatePumpFeeRouting(launch, creatorWallet, 0);
  }

  onPhase("syncing");
  onPhase("done");
  return launch;
}

export type { LaunchProgressPhase, TokenLaunchFormFields };
