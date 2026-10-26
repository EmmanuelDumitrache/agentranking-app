"use client";

import type { TokenLaunchFormFields } from "@/lib/agent-launch/token-launch-client";
import type { SerializedMetaplexLaunchAttempt } from "@/lib/metaplex-launch/types";

export type PublicMetaplexProgressPhase =
  | "idle"
  | "draft"
  | "funding"
  | "upload"
  | "mint_agent"
  | "genesis"
  | "index"
  | "done";

export type MetaplexFundingStage =
  | "initial"
  | "post_irys"
  | "post_agent"
  | "post_genesis"
  | "complete";

export const PUBLIC_METAPLEX_ATTEMPT_STORAGE_KEY = "ar-public-metaplex-attempt-id";

export type PublicMetaplexFundingInfo = {
  attemptId: string;
  custodialWallet: string;
  balanceLamports: number;
  minLamports: number;
  shortfallLamports: number;
  stage: MetaplexFundingStage;
  fundingMessage: string;
  funded: boolean;
};

export type PublicMetaplexPrepared = {
  attempt: SerializedMetaplexLaunchAttempt;
  agentDbId: number;
  custodialWallet: string;
  balanceLamports: number;
  minLamports: number;
  shortfallLamports: number;
  funded: boolean;
  stage: MetaplexFundingStage;
  fundingMessage: string;
};

export type PublicMetaplexOpenAttempt = PublicMetaplexPrepared & {
  tokenName: string | null;
  tokenSymbol: string | null;
  tokenImageUrl: string | null;
};

async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: { error?: string } & T;
  try {
    body = (text ? JSON.parse(text) : {}) as { error?: string } & T;
  } catch {
    const snippet = text.replace(/\s+/g, " ").trim().slice(0, 160);
    throw new Error(
      snippet
        ? `Server error (${res.status}): ${snippet}`
        : `Request failed (${res.status}) with empty response.`,
    );
  }
  if (!res.ok) {
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return body;
}

export function persistPublicMetaplexAttemptId(attemptId: string): void {
  try {
    localStorage.setItem(PUBLIC_METAPLEX_ATTEMPT_STORAGE_KEY, attemptId);
  } catch {
    // ignore quota / private mode
  }
}

export function readPublicMetaplexAttemptId(): string | null {
  try {
    return localStorage.getItem(PUBLIC_METAPLEX_ATTEMPT_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function clearPublicMetaplexAttemptId(): void {
  try {
    localStorage.removeItem(PUBLIC_METAPLEX_ATTEMPT_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export async function fetchOpenPublicMetaplexAttempt(): Promise<PublicMetaplexOpenAttempt | null> {
  const res = await fetch("/api/public-launch/metaplex/open", { cache: "no-store" });
  const body = await parseJson<{ attempt: PublicMetaplexOpenAttempt | null }>(res);
  return body.attempt;
}

export async function preparePublicMetaplexLaunch(
  fields: TokenLaunchFormFields,
): Promise<PublicMetaplexPrepared> {
  const res = await fetch("/api/public-launch/metaplex/prepare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tokenName: fields.tokenName,
      tokenSymbol: fields.tokenSymbol,
      tokenDescription: fields.tokenDescription,
      tokenImageUrl: fields.tokenImageUrl,
      website: fields.website,
      twitter: fields.twitter,
      telegram: fields.telegram,
      firstBuySol: "0",
    }),
  });
  const prepared = await parseJson<PublicMetaplexPrepared>(res);
  persistPublicMetaplexAttemptId(prepared.attempt.id);
  return prepared;
}

export async function pollPublicMetaplexFunding(attemptId: string): Promise<PublicMetaplexFundingInfo> {
  const res = await fetch(`/api/public-launch/metaplex/${attemptId}/funding`, {
    cache: "no-store",
  });
  const body = await parseJson<{
    custodialWallet: string;
    balanceLamports: number;
    minLamports: number;
    shortfallLamports: number;
    funded: boolean;
    stage: MetaplexFundingStage;
    fundingMessage: string;
  }>(res);
  return {
    attemptId,
    custodialWallet: body.custodialWallet,
    balanceLamports: body.balanceLamports,
    minLamports: body.minLamports,
    shortfallLamports: body.shortfallLamports,
    funded: body.funded,
    stage: body.stage,
    fundingMessage: body.fundingMessage,
  };
}

export async function uploadPublicMetaplexIrysImage(input: {
  attemptId: string;
  file: File;
}): Promise<{ imageUri: string; attempt: SerializedMetaplexLaunchAttempt }> {
  const form = new FormData();
  form.append("file", input.file);
  const res = await fetch(`/api/public-launch/metaplex/${input.attemptId}/upload-irys`, {
    method: "POST",
    body: form,
  });
  return parseJson(res);
}

export async function executePublicMetaplexLaunch(
  attemptId: string,
): Promise<SerializedMetaplexLaunchAttempt> {
  const res = await fetch(`/api/public-launch/metaplex/${attemptId}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ permanentBindConfirmed: true }),
  });
  const body = await parseJson<{ attempt: SerializedMetaplexLaunchAttempt }>(res);
  return body.attempt;
}

export async function continuePublicMetaplexLaunch(
  attemptId: string,
): Promise<SerializedMetaplexLaunchAttempt> {
  const res = await fetch(`/api/public-launch/metaplex/${attemptId}/continue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ permanentBindConfirmed: true }),
  });
  const body = await parseJson<{ attempt: SerializedMetaplexLaunchAttempt }>(res);
  return body.attempt;
}

function fundingInfoFromPrepared(prepared: PublicMetaplexPrepared): PublicMetaplexFundingInfo {
  return {
    attemptId: prepared.attempt.id,
    custodialWallet: prepared.custodialWallet,
    balanceLamports: prepared.balanceLamports,
    minLamports: prepared.minLamports,
    shortfallLamports: prepared.shortfallLamports,
    funded: prepared.funded,
    stage: prepared.stage,
    fundingMessage: prepared.fundingMessage,
  };
}

/**
 * Full public Metaplex path.
 * If the custodial wallet is underfunded, throws with code-like message containing the deposit address
 * after calling onNeedsFunding — caller should pause UI for the user to send SOL, then retry.
 */
export async function runPublicMetaplexQuickLaunch(options: {
  fields: TokenLaunchFormFields;
  imageFile: File;
  permanentBindConfirmed: boolean;
  onPhase: (phase: PublicMetaplexProgressPhase) => void;
  onNeedsFunding: (info: PublicMetaplexFundingInfo) => void;
  waitForFunding?: () => Promise<void>;
}): Promise<SerializedMetaplexLaunchAttempt> {
  if (!options.permanentBindConfirmed) {
    throw new Error("Confirm permanent Metaplex token binding before launching.");
  }
  if (!options.imageFile) {
    throw new Error("Token artwork file is required for Metaplex Irys upload.");
  }

  options.onPhase("draft");
  let prepared = await preparePublicMetaplexLaunch(options.fields);

  if (!prepared.funded) {
    options.onPhase("funding");
    options.onNeedsFunding(fundingInfoFromPrepared(prepared));
    if (options.waitForFunding) {
      await options.waitForFunding();
    } else {
      throw new Error(prepared.fundingMessage);
    }
    const funding = await pollPublicMetaplexFunding(prepared.attempt.id);
    if (!funding.funded) {
      throw new Error(funding.fundingMessage);
    }
    prepared = { ...prepared, ...funding, funded: true };
  }

  options.onPhase("upload");
  await uploadPublicMetaplexIrysImage({
    attemptId: prepared.attempt.id,
    file: options.imageFile,
  });

  options.onPhase("mint_agent");
  options.onPhase("genesis");
  const attempt = await executePublicMetaplexLaunch(prepared.attempt.id);

  if (attempt.status === "COMPLETE") {
    clearPublicMetaplexAttemptId();
    options.onPhase("done");
    return attempt;
  }
  if (attempt.status === "AR_INDEX_PENDING") {
    options.onPhase("index");
  }
  options.onPhase("done");
  return attempt;
}
