"use client";
import {
  OPENVECTA_CHAT_COMPLETIONS_URL,
  OPENVECTA_DEFAULT_MAX_TOKENS,
  OPENVECTA_MAX_MAX_TOKENS,
  OPENVECTA_MAX_MESSAGES,
  OPENVECTA_MAX_MESSAGE_CHARS,
  OPENVECTA_MAX_REQUEST_BYTES,
  OPENVECTA_MAX_RESPONSE_BYTES,
  OPENVECTA_MAX_TOTAL_MESSAGE_CHARS,
  OPENVECTA_MIN_MAX_TOKENS,
  OPENVECTA_REQUEST_TIMEOUT_MS,
} from "@/lib/inference-providers/openvecta-models";
import { createInferencePaymentFetch } from "@/lib/inference-providers/x402-payment-fetch.client";
import type { WalletClient } from "viem";

export type OpenVectaChatMessage = { role: "user" | "assistant" | "system"; content: string };
export type OpenVectaChatResult = {
  text: string;
  model: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};
export type RunOpenVectaChatInput = {
  walletClient: WalletClient;
  model: string;
  messages: OpenVectaChatMessage[];
  maxTokens?: number;
};
function extractAssistantText(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const content = (choices[0] as { message?: { content?: unknown } }).message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
    ? (part as { text: string }).text : "").join("");
}
async function readBoundedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    bytes += value.byteLength;
    if (bytes > OPENVECTA_MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("OpenVecta response exceeded the maximum allowed size");
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(joined);
  return text ? JSON.parse(text) as unknown : null;
}
function validateInput(input: RunOpenVectaChatInput) {
  const model = input.model.trim();
  if (!model || model.length > 200) throw new Error("Invalid model id");
  if (!Array.isArray(input.messages) || input.messages.length < 1 || input.messages.length > OPENVECTA_MAX_MESSAGES) {
    throw new Error(`Messages must contain 1-${OPENVECTA_MAX_MESSAGES} entries`);
  }
  let total = 0;
  const messages = input.messages.map((message) => {
    if (!(["user", "assistant", "system"] as const).includes(message.role)) throw new Error("Invalid chat role");
    if (typeof message.content !== "string" || message.content.length > OPENVECTA_MAX_MESSAGE_CHARS) {
      throw new Error(`Each message must be at most ${OPENVECTA_MAX_MESSAGE_CHARS} characters`);
    }
    total += message.content.length;
    return { role: message.role, content: message.content };
  });
  if (total > OPENVECTA_MAX_TOTAL_MESSAGE_CHARS) throw new Error("Conversation is too large");
  const maxTokens = Math.min(OPENVECTA_MAX_MAX_TOKENS, Math.max(
    OPENVECTA_MIN_MAX_TOKENS,
    Math.trunc(input.maxTokens ?? OPENVECTA_DEFAULT_MAX_TOKENS),
  ));
  const body = JSON.stringify({ model, messages, max_tokens: maxTokens, stream: false });
  if (new TextEncoder().encode(body).byteLength > OPENVECTA_MAX_REQUEST_BYTES) throw new Error("OpenVecta request is too large");
  return { model, body };
}
export async function runOpenVectaChat(input: RunOpenVectaChatInput): Promise<OpenVectaChatResult> {
  const validated = validateInput(input);
  const fetchWithPay = createInferencePaymentFetch(
    input.walletClient,
    OPENVECTA_CHAT_COMPLETIONS_URL,
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("OpenVecta request timed out")), OPENVECTA_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchWithPay(OPENVECTA_CHAT_COMPLETIONS_URL, {
      method: "POST",
      signal: controller.signal,
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: validated.body,
    });
    const raw = await readBoundedJson(response);
    if (!response.ok) {
      const error = raw && typeof raw === "object" && "error" in raw ? (raw as { error: unknown }).error : null;
      throw new Error(typeof error === "string" ? error.slice(0, 1_000) : `OpenVecta request failed (${response.status})`);
    }
    const usage = raw && typeof raw === "object" && "usage" in raw
      ? (raw as { usage?: OpenVectaChatResult["usage"] }).usage : undefined;
    return { text: extractAssistantText(raw), model: validated.model, usage };
  } finally { clearTimeout(timer); }
}
