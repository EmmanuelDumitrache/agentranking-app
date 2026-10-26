"use client";
import { Keypair } from "@solana/web3.js";
import type { SerializedAgentLaunch } from "@/components/agent-launch/types";
import {
  signAndSendAgentLaunchTransaction,
} from "@/lib/agent-launch/wallet-client";
import { isLaunchIndexed } from "@/lib/agent-launch/launch-wizard-state";
import type { TokenLaunchFormFields } from "@/lib/agent-launch/token-launch-utils";
import { retryClientOperation } from "@/lib/timing/client-retry";
export type { TokenLaunchFormFields } from "@/lib/agent-launch/token-launch-utils";
export {
  mapTokenLaunchError,
  validateTokenLaunchForm,
} from "@/lib/agent-launch/token-launch-utils";
type ApiLaunchResponse = {
  launch?: SerializedAgentLaunch;
  error?: string;
  recovered?: boolean;
  recoveredMint?: string | null;
};
export type FetchLaunchDraftResult = {
  launch: SerializedAgentLaunch;
  recovered: boolean;
  recoveredMint: string | null;
};
async function parseLaunchResponse(res: Response): Promise<SerializedAgentLaunch> {
  const data = (await res.json()) as ApiLaunchResponse;
  if (!res.ok || !data.launch) {
    throw new Error(data.error || "Launch request failed");
  }
  return data.launch;
}
async function recoverTokenCreateOnChain(input: {
  launchId: string;
  creatorWallet: string;
}): Promise<SerializedAgentLaunch | null> {
  const res = await fetch("/api/agent-launch/recover-create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      launchId: input.launchId,
      creatorWallet: input.creatorWallet,
    }),
  });
  const data = (await res.json()) as ApiLaunchResponse & { onChain?: boolean };
  if (res.ok && data.launch) {
    return data.launch;
  }
  return null;
}
export async function fetchLaunchDraft(
  draftId: string,
  creatorWallet?: string | null,
): Promise<FetchLaunchDraftResult> {
  const params = new URLSearchParams();
  if (creatorWallet?.trim()) {
    params.set("creatorWallet", creatorWallet.trim());
  }
  const query = params.toString();
  const res = await fetch(
    `/api/agent-launch/drafts/${draftId}${query ? `?${query}` : ""}`,
  );
  const data = (await res.json()) as ApiLaunchResponse;
  if (!res.ok || !data.launch) {
    throw new Error(data.error || "Could not load launch");
  }
  return {
    launch: data.launch,
    recovered: data.recovered === true,
    recoveredMint: data.recoveredMint ?? null,
  };
}
export async function createLaunchDraft(
  agentId: string,
  creatorWallet: string,
): Promise<SerializedAgentLaunch> {
  const res = await fetch("/api/agent-launch/drafts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentId, creatorWallet }),
  });
  const data = (await res.json()) as ApiLaunchResponse;
  if (!res.ok || !data.launch) {
    throw new Error(data.error || "Could not start launch");
  }
  return data.launch;
}
export async function patchLaunchDraft(
  launchId: string,
  fields: Partial<
    TokenLaunchFormFields & {
      agentId: string;
      creatorWallet: string;
      profileWebsite?: string;
      profileTwitter?: string;
      profileTelegram?: string;
      profileGithub?: string;
      profileTags?: string[];
      archetype?: string;
      profileServices?: Array<{ name: string; endpoint: string; version?: string }>;
    }
  >,
): Promise<SerializedAgentLaunch> {
  const res = await fetch(`/api/agent-launch/drafts/${launchId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
  return parseLaunchResponse(res);
}
export async function saveLaunchProfileEnrichment(
  agentDbId: number,
  input: {
    launchId?: string | null;
    website?: string;
    github?: string;
    archetype?: string;
    capabilityTags?: string[];
    services?: Array<{ name: string; endpoint: string; version?: string }>;
    twitter?: string;
    telegram?: string;
    tokenImageUrl?: string;
    tokenName?: string;
    tokenDescription?: string;
  },
): Promise<void> {
  const res = await fetch(`/api/dashboard/agents/${agentDbId}/launch-enrichment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = (await res.json()) as { error?: string };
  if (!res.ok) throw new Error(data.error || "Could not save profile enrichment");
}

export async function publishLaunchMetadata(
  launchId: string,
  imagePlaceholder: string,
  proposedMint?: string | null,
  twitter?: string | null,
  telegram?: string | null,
): Promise<SerializedAgentLaunch> {
  const res = await fetch("/api/agent-launch/metadata", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      launchId,
      imagePlaceholder,
      mint: proposedMint?.trim() || null,
      twitter: twitter?.trim() || null,
      telegram: telegram?.trim() || null,
    }),
  });
  const data = (await res.json()) as ApiLaunchResponse;
  if (!res.ok || !data.launch) {
    throw new Error(data.error || "Could not publish token metadata");
  }
  return data.launch;
}
export async function createPumpTokenOnChain(
  launch: SerializedAgentLaunch,
  creatorWallet: string,
  mintKeypair: Keypair,
  agentDbId: number,
  onPhase?: (phase: LaunchProgressPhase) => void,
): Promise<SerializedAgentLaunch> {
  const mintAddress = mintKeypair.publicKey.toBase58();
  if (launch.launchStatus === "draft" && launch.metadataUri) {
    const recovered = await recoverTokenCreateOnChain({
      launchId: launch.id,
      creatorWallet,
    });
    if (recovered) {
      onPhase?.("confirming");
      return recovered;
    }
  }
  const buildRes = await fetch("/api/agent-launch/build-create-tx", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      launchId: launch.id,
      creatorWallet,
      mint: mintAddress,
    }),
  });
  const buildData = (await buildRes.json()) as {
    error?: string;
    code?: string;
    transaction?: string;
    pumpCreateIncluded?: boolean;
    warnings?: string[];
  };
  if (buildRes.status === 409 && buildData.code === "mint_already_on_chain") {
    const recovered = await recoverTokenCreateOnChain({
      launchId: launch.id,
      creatorWallet,
    });
    if (recovered) {
      onPhase?.("confirming");
      return recovered;
    }
    throw new Error(
      buildData.error ||
        "This token already exists on Pump.fun. Wait a moment and try again to finish setup.",
    );
  }
  if (!buildRes.ok) {
    throw new Error(buildData.error || "Could not build create transaction");
  }
  if (!buildData.pumpCreateIncluded || !buildData.transaction) {
    throw new Error("Launch backend is not ready to create this token yet.");
  }
  onPhase?.("signing");
  let signature: string;
  try {
    signature = await signAndSendAgentLaunchTransaction({
      transactionBase64: buildData.transaction,
      mintSecretKey: mintKeypair.secretKey,
      agentDbId,
      creatorWallet,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message.toLowerCase().includes("already in use")) {
      const recovered = await recoverTokenCreateOnChain({
        launchId: launch.id,
        creatorWallet,
      });
      if (recovered) {
        onPhase?.("confirming");
        return recovered;
      }
    }
    throw err;
  }
  onPhase?.("sending");
  onPhase?.("confirming");
  let lastError = "Could not confirm token creation";
  class TokenConfirmationError extends Error {
    constructor(readonly retryable: boolean, message: string) {
      super(message);
      this.name = "TokenConfirmationError";
    }
  }
  try {
    return await retryClientOperation(
      async () => {
        const confirmRes = await fetch("/api/agent-launch/confirm-create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            launchId: launch.id,
            signature,
            mint: mintAddress,
            creatorWallet,
          }),
        });
        if (confirmRes.ok) return parseLaunchResponse(confirmRes);
        const confirmData = (await confirmRes.json()) as { error?: string };
        lastError = confirmData.error || lastError;
        const retryable =
          confirmRes.status >= 500 ||
          lastError.toLowerCase().includes("not found on mainnet") ||
          lastError.toLowerCase().includes("not found on devnet");
        throw new TokenConfirmationError(retryable, lastError);
      },
      {
        retries: 4,
        factor: 1.8,
        minDelayMs: 2_000,
        maxDelayMs: 12_000,
        shouldRetry: (error) =>
          (error instanceof TokenConfirmationError && error.retryable) || error instanceof TypeError,
      },
    );
  } catch (error) {
    lastError = error instanceof Error ? error.message : lastError;
  }
  const recovered = await recoverTokenCreateOnChain({
    launchId: launch.id,
    creatorWallet,
  });
  if (recovered) {
    return recovered;
  }
  throw new Error(lastError);
}
export async function activatePumpFeeRouting(
  launch: SerializedAgentLaunch,
  creatorWallet: string,
  agentDbId: number,
): Promise<SerializedAgentLaunch> {
  if (!launch.mint) {
    throw new Error("Token mint is missing. Cannot activate fee routing.");
  }
  const buildRes = await fetch("/api/agent-launch/build-fee-share-tx", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      launchId: launch.id,
      creatorWallet,
      mint: launch.mint,
    }),
  });
  const buildData = (await buildRes.json()) as {
    error?: string;
    transaction?: string;
    sharingConfig?: string;
  };
  if (!buildRes.ok || !buildData.transaction) {
    throw new Error(buildData.error || "Could not build fee routing transaction");
  }
  const signature = await signAndSendAgentLaunchTransaction({
    transactionBase64: buildData.transaction,
    agentDbId,
    creatorWallet,
  });
  const confirmRes = await fetch("/api/agent-launch/confirm-fee-share", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      launchId: launch.id,
      signature,
      sharingConfig: buildData.sharingConfig,
    }),
  });
  return parseLaunchResponse(confirmRes);
}
export type LaunchProgressPhase =
  | "idle"
  | "draft"
  | "details"
  | "metadata"
  | "preparing"
  | "signing"
  | "sending"
  | "confirming"
  | "create"
  | "routing"
  | "syncing"
  | "done"
  | "error";
function metadataDoesNotMatchFields(
  launch: SerializedAgentLaunch,
  fields: TokenLaunchFormFields,
): boolean {
  const json =
    launch.metadataJson && typeof launch.metadataJson === "object"
      ? (launch.metadataJson as { name?: unknown; symbol?: unknown })
      : null;
  const jsonName = typeof json?.name === "string" ? json.name.trim() : "";
  const jsonSymbol = typeof json?.symbol === "string" ? json.symbol.trim() : "";
  const name = fields.tokenName.trim();
  const symbol = fields.tokenSymbol.trim().toUpperCase();
  if (!name || !symbol) return false;
  return jsonName !== name || jsonSymbol.toUpperCase() !== symbol;
}

export async function runTokenLaunchPipeline(options: {
  agentId: string;
  creatorWallet: string;
  fields: TokenLaunchFormFields;
  profile?: {
    website?: string;
    github?: string;
    archetype?: string;
    capabilityTags?: string[];
    services?: Array<{ name: string; endpoint: string; version?: string }>;
  };
  existingLaunch: SerializedAgentLaunch | null;
  mintKeypair: Keypair;
  onPhase: (phase: LaunchProgressPhase) => void;
}): Promise<SerializedAgentLaunch> {
  const { agentId, creatorWallet, fields, mintKeypair, onPhase } = options;
  let launch = options.existingLaunch;
  if (launch && isLaunchIndexed(launch)) {
    onPhase("done");
    return launch;
  }
  if (
    !launch ||
    launch.launchStatus === "draft" ||
    !launch.tokenName?.trim()
  ) {
    onPhase("draft");
    if (!launch) {
      launch = await createLaunchDraft(agentId, creatorWallet);
    }
    onPhase("details");
    launch = await patchLaunchDraft(launch.id, {
      agentId,
      creatorWallet,
      tokenName: fields.tokenName,
      tokenSymbol: fields.tokenSymbol,
      tokenDescription: fields.tokenDescription,
      tokenImageUrl: fields.tokenImageUrl,
    });
  }
  if (!launch.metadataUri || metadataDoesNotMatchFields(launch, fields)) {
    onPhase("metadata");
    const preMint = mintKeypair.publicKey.toBase58();
    launch = await publishLaunchMetadata(
      launch.id,
      fields.tokenImageUrl.trim(),
      preMint,
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
    launch = await createPumpTokenOnChain(launch, creatorWallet, mintKeypair, Number(agentId), onPhase);
  }
  if (!isLaunchIndexed(launch)) {
    onPhase("routing");
    launch = await activatePumpFeeRouting(launch, creatorWallet, Number(agentId));
  }
  onPhase("syncing");
  onPhase("done");
  return launch;
}