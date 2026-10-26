import type {
  MetaplexLaunchInputSnapshot,
  MetaplexLaunchProgressPhase,
  SerializedMetaplexLaunchAttempt,
} from "@/lib/metaplex-launch/types";
import { mapMetaplexLaunchError } from "@/lib/metaplex-launch/errors";
import { isValidIrysGatewayUrl } from "@/lib/metaplex-launch/validation";

export type MetaplexLaunchFormInput = MetaplexLaunchInputSnapshot & {
  permanentBindConfirmed: boolean;
};

async function parseJson<T>(res: Response): Promise<T> {
  const body = (await res.json()) as { error?: string } & T;
  if (!res.ok) {
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return body;
}

export async function fetchMetaplexLaunchAttemptByAgent(
  agentDbId: number,
): Promise<SerializedMetaplexLaunchAttempt | null> {
  const res = await fetch(`/api/metaplex-launch/attempts/by-agent?agentDbId=${agentDbId}`, {
    cache: "no-store",
  });
  if (res.status === 404) return null;
  const body = await parseJson<{ attempt: SerializedMetaplexLaunchAttempt | null }>(res);
  return body.attempt;
}

export async function createMetaplexLaunchAttempt(input: {
  agentDbId: number;
  fields: MetaplexLaunchInputSnapshot;
}): Promise<SerializedMetaplexLaunchAttempt> {
  const res = await fetch("/api/metaplex-launch/attempts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await parseJson<{ attempt: SerializedMetaplexLaunchAttempt }>(res);
  return body.attempt;
}

export async function uploadMetaplexIrysImage(input: {
  attemptId: string;
  file: File;
}): Promise<string> {
  const form = new FormData();
  form.append("file", input.file);
  const res = await fetch(`/api/metaplex-launch/attempts/${input.attemptId}/upload-irys`, {
    method: "POST",
    body: form,
  });
  const body = await parseJson<{ imageUri: string }>(res);
  return body.imageUri;
}

export async function executeMetaplexLaunchAttempt(input: {
  attemptId: string;
  permanentBindConfirmed: boolean;
}): Promise<SerializedMetaplexLaunchAttempt> {
  const res = await fetch(`/api/metaplex-launch/attempts/${input.attemptId}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ permanentBindConfirmed: input.permanentBindConfirmed }),
  });
  const body = await parseJson<{ attempt: SerializedMetaplexLaunchAttempt }>(res);
  return body.attempt;
}

export async function retryMetaplexLaunchIndex(
  attemptId: string,
): Promise<SerializedMetaplexLaunchAttempt> {
  const res = await fetch(`/api/metaplex-launch/attempts/${attemptId}/index`, {
    method: "POST",
  });
  const body = await parseJson<{ attempt: SerializedMetaplexLaunchAttempt }>(res);
  return body.attempt;
}

export async function runMetaplexLaunchPipeline(input: {
  agentDbId: number;
  fields: MetaplexLaunchFormInput;
  onPhase?: (phase: MetaplexLaunchProgressPhase) => void;
}): Promise<SerializedMetaplexLaunchAttempt> {
  const onPhase = input.onPhase;
  onPhase?.("draft");

  let attempt = await createMetaplexLaunchAttempt({
    agentDbId: input.agentDbId,
    fields: input.fields,
  });

  if (!isValidIrysGatewayUrl(input.fields.tokenImageUrl)) {
    onPhase?.("upload");
    throw new Error("Upload a token image with the Upload image button before launching.");
  }

  onPhase?.("mint_agent");
  onPhase?.("genesis");
  attempt = await executeMetaplexLaunchAttempt({
    attemptId: attempt.id,
    permanentBindConfirmed: input.fields.permanentBindConfirmed,
  });

  if (attempt.status === "AR_INDEX_PENDING") {
    onPhase?.("index");
    attempt = await retryMetaplexLaunchIndex(attempt.id);
  }

  if (attempt.status === "COMPLETE") {
    onPhase?.("done");
    return attempt;
  }

  if (attempt.status === "AR_INDEX_PENDING") {
    onPhase?.("index");
    throw new Error("Launch succeeded but AgentRanking indexing is still finishing. Retry shortly.");
  }

  onPhase?.("done");
  return attempt;
}

export function mapMetaplexLaunchClientError(err: unknown): string {
  return mapMetaplexLaunchError(err).message;
}

export type { MetaplexLaunchProgressPhase, SerializedMetaplexLaunchAttempt } from "@/lib/metaplex-launch/types";
