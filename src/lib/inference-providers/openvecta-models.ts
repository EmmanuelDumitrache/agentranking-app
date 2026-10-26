/** Cheap OpenVecta models suitable for dashboard smoke tests (pay-per-call x402). */
export const OPENVECTA_PLAYGROUND_MODELS = [
  { id: "glm-4.7-flash", label: "GLM 4.7 Flash (fast, low cost)" },
  { id: "gpt-oss-20b", label: "GPT OSS 20B" },
  { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
] as const;
export const OPENVECTA_CHAT_COMPLETIONS_URL = "https://api.openvecta.com/v1/chat/completions";
/** OpenVecta rejects reasoning models below 256 max_tokens. */
export const OPENVECTA_MIN_MAX_TOKENS = 256;
export const OPENVECTA_DEFAULT_MAX_TOKENS = 256;
export const OPENVECTA_MAX_MAX_TOKENS = 4_096;
export const OPENVECTA_REQUEST_TIMEOUT_MS = 45_000;
export const OPENVECTA_MAX_REQUEST_BYTES = 256 * 1024;
export const OPENVECTA_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const OPENVECTA_MAX_MESSAGES = 64;
export const OPENVECTA_MAX_MESSAGE_CHARS = 32_000;
export const OPENVECTA_MAX_TOTAL_MESSAGE_CHARS = 128_000;
