import "server-only";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
/**
 * Centralized OpenRouter provider instance.
 * ALL code that creates OpenRouter models MUST use this instance.
 * Never import the `openrouter` global singleton from @openrouter/ai-sdk-provider directly.
 */
export const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});