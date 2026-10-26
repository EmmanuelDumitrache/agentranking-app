import "server-only";
import { randomInt } from "node:crypto";
import { z } from "zod";
import { parseBoundedJsonBody } from "@/lib/bounded-http-body";
import { detectImageMimeType } from "@/lib/image-upload-validation";
import { uploadFile } from "@/lib/upload";

const OpenRouterImageResponseSchema = z.object({
  data: z.array(z.object({
    b64_json: z.string().optional(),
    media_type: z.string().optional(),
    url: z.string().optional(),
  })).optional(),
});

const DEFAULT_OPENROUTER_MODEL = "black-forest-labs/flux.2-klein-4b";
const POLLINATIONS_BASE = "https://image.pollinations.ai/prompt";

export type AgentAvatarGenerateInput = {
  readonly agentName?: string;
  readonly persona?: string;
};

export type AgentAvatarGenerateResult = {
  readonly url: string;
  readonly publicUrl: string;
  readonly provider: "openrouter" | "pollinations";
  readonly model: string;
};

function sanitizeSnippet(value: string | undefined, maxLen: number): string {
  if (!value) return "";
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

/** AgentRanking-themed square avatar prompt — robot / agent mark, dark zinc palette. */
export function buildAgentAvatarPrompt(input: AgentAvatarGenerateInput): string {
  const name = sanitizeSnippet(input.agentName, 40) || "AI agent";
  const persona = sanitizeSnippet(input.persona, 80);
  const role = persona ? `, ${persona}` : "";
  return [
    `Square avatar icon, stylized friendly robot agent named ${name}${role}.`,
    "AgentRanking crypto AI marketplace style, dark zinc background,",
    "subtle emerald accent, clean geometric face, centered bust, no text, no watermark.",
  ].join(" ");
}

function openRouterModel(): string {
  return (
    process.env.AGENT_AVATAR_IMAGE_MODEL?.trim() ||
    DEFAULT_OPENROUTER_MODEL
  );
}

function looksLikeHtml(bytes: Buffer): boolean {
  const head = bytes.subarray(0, 256).toString("utf8").trimStart().toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html") || head.startsWith("{");
}

function assertGeneratedImageBytes(bytes: Buffer): string {
  if (looksLikeHtml(bytes)) {
    throw new Error("Image provider returned an error page instead of an image");
  }
  const detected = detectImageMimeType(bytes.subarray(0, 16));
  if (!detected) {
    throw new Error("Generated image is not a valid image file");
  }
  return detected;
}

async function generateViaOpenRouter(
  prompt: string,
): Promise<{ bytes: Buffer; mimeType: string; model: string } | null> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return null;
  const model = openRouterModel();
  const res = await fetch("https://openrouter.ai/api/v1/images", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://agentranking.io",
      "X-Title": "AgentRanking",
    },
    body: JSON.stringify({
      model,
      prompt,
      aspect_ratio: "1:1",
      resolution: "512",
      output_format: "png",
      n: 1,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (res.status === 402 || res.status === 401 || res.status === 403) {
    return null;
  }
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    const detail = errBody ? `: ${errBody.slice(0, 200)}` : "";
    throw new Error(`OpenRouter image generation failed (${res.status})${detail}`);
  }
  const body = await parseBoundedJsonBody(res, OpenRouterImageResponseSchema, 8 * 1024 * 1024);
  const image = body.data?.[0];
  if (!image) throw new Error("OpenRouter returned no image data");
  if (image.b64_json) {
    const bytes = Buffer.from(image.b64_json, "base64");
    const mimeType = assertGeneratedImageBytes(bytes);
    return { bytes, mimeType, model };
  }
  if (image.url?.startsWith("http")) {
    const fetched = await fetch(image.url, { signal: AbortSignal.timeout(30_000) });
    if (!fetched.ok) throw new Error("Failed to download OpenRouter image URL");
    const arrayBuffer = await fetched.arrayBuffer();
    const bytes = Buffer.from(arrayBuffer);
    const mimeType = assertGeneratedImageBytes(bytes);
    return { bytes, mimeType, model };
  }
  throw new Error("OpenRouter image payload missing b64_json and url");
}

async function generateViaPollinations(
  prompt: string,
): Promise<{ bytes: Buffer; mimeType: string; model: string }> {
  const seed = randomInt(0, 1_000_000_000);
  const url = new URL(`${POLLINATIONS_BASE}/${encodeURIComponent(prompt)}`);
  url.searchParams.set("width", "512");
  url.searchParams.set("height", "512");
  url.searchParams.set("nologo", "true");
  url.searchParams.set("model", "flux");
  url.searchParams.set("seed", String(seed));
  // Bust CDN caches so regenerate always returns a fresh image.
  url.searchParams.set("t", String(Date.now()));
  const res = await fetch(url.toString(), {
    headers: {
      Accept: "image/*",
      "Cache-Control": "no-cache",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(45_000),
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`Free image generation failed (${res.status})`);
  }
  const arrayBuffer = await res.arrayBuffer();
  if (arrayBuffer.byteLength < 1_024 || arrayBuffer.byteLength > 5 * 1024 * 1024) {
    throw new Error("Generated image size is invalid");
  }
  const bytes = Buffer.from(arrayBuffer);
  const mimeType = assertGeneratedImageBytes(bytes);
  return { bytes, mimeType, model: "pollinations/flux" };
}

function extensionForMime(mimeType: string): string {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

/**
 * Generate a themed agent avatar and persist it under agent-images.
 * Uses free Pollinations by default; OpenRouter only when AGENT_AVATAR_IMAGE_PROVIDER=openrouter.
 */
export async function generateAndStoreAgentAvatar(
  input: AgentAvatarGenerateInput,
): Promise<AgentAvatarGenerateResult> {
  const prompt = buildAgentAvatarPrompt(input);
  const preferOpenRouter =
    process.env.AGENT_AVATAR_IMAGE_PROVIDER?.trim().toLowerCase() === "openrouter";

  let generated: { bytes: Buffer; mimeType: string; model: string } | null = null;
  let provider: "openrouter" | "pollinations" = "pollinations";

  if (preferOpenRouter) {
    try {
      generated = await generateViaOpenRouter(prompt);
      if (generated) provider = "openrouter";
    } catch (error) {
      console.warn("[agent-avatar-generate] OpenRouter failed, falling back:", error);
    }
  }

  if (!generated) {
    generated = await generateViaPollinations(prompt);
    provider = "pollinations";
  }

  const ext = extensionForMime(generated.mimeType);
  const file = new File([new Uint8Array(generated.bytes)], `ai-avatar.${ext}`, {
    type: generated.mimeType,
  });
  const uploaded = await uploadFile(file, generated.mimeType, {
    prefix: "agent-images",
  });
  return {
    url: uploaded.url,
    publicUrl: uploaded.publicUrl,
    provider,
    model: generated.model,
  };
}
