import type { RuntimeMcpToolMetadata } from "./types";

const metadata = new WeakMap<object, RuntimeMcpToolMetadata>();

export function markMcpToolMetadata<T extends object>(
  tool: T,
  value: RuntimeMcpToolMetadata,
): T {
  metadata.set(tool, value);
  return tool;
}

export function getMcpToolMetadata(value: unknown): RuntimeMcpToolMetadata | undefined {
  return value && typeof value === "object" ? metadata.get(value) : undefined;
}

export function copyMcpToolMetadata(source: unknown, target: object): void {
  const value = getMcpToolMetadata(source);
  if (value) metadata.set(target, value);
}
