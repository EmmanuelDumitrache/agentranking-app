import "server-only";

import type { LlmProviderDescriptor } from "@/lib/llm-provider/credential-contracts";
import type { ProviderCredentialAdapter as RegistryAdapter } from "./provider-adapter";
import { anthropicAdapter } from "./providers/anthropic";
import { deepSeekAdapter } from "./providers/deepseek";
import { googleAiStudioAdapter } from "./providers/google-ai-studio";
import { openAiAdapter } from "./providers/openai";

export type {
  ProviderCredentialAdapter,
  ProviderModelRuntime,
  ProviderRuntimeContext,
} from "./provider-adapter";

const adapters = new Map<string, RegistryAdapter>([
  [googleAiStudioAdapter.descriptor.id, googleAiStudioAdapter],
  [openAiAdapter.descriptor.id, openAiAdapter],
  [anthropicAdapter.descriptor.id, anthropicAdapter],
  [deepSeekAdapter.descriptor.id, deepSeekAdapter],
]);

export function listProviderCredentialAdapters(): readonly RegistryAdapter[] {
  return [...adapters.values()];
}

export function listProviderCredentialDescriptors(): LlmProviderDescriptor[] {
  return [...adapters.values()].map((adapter) => adapter.descriptor);
}

export function getProviderCredentialAdapter(provider: string): RegistryAdapter | null {
  return adapters.get(provider.trim().toLowerCase()) ?? null;
}
