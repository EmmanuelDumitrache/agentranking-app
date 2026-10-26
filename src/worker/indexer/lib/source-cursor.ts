import { createHash } from "node:crypto";
export const WORKER_CONFIGURATION_GENERATION =
  process.env.INDEXER_CONFIGURATION_GENERATION?.trim() || "runtime-config-v4";
export function registryGenerationKey(input: {
  chainId: number;
  domain: string;
  registryAddress: string;
  eventSignature: string;
  deploymentBlock: bigint;
}): string {
  const material = [
    WORKER_CONFIGURATION_GENERATION,
    String(input.chainId),
    input.domain,
    input.registryAddress.toLowerCase(),
    input.eventSignature,
    input.deploymentBlock.toString(10),
  ].join("\0");
  return createHash("sha256").update(material).digest("hex");
}
export function registrySourceKey(input: {
  chainId: number;
  domain: string;
  registryAddress: string;
  eventSignature: string;
  deploymentBlock: bigint;
}): { sourceKey: string; registryGeneration: string } {
  const registryGeneration = registryGenerationKey(input);
  return {
    sourceKey: `evm:${input.chainId}:${input.domain}:${input.registryAddress.toLowerCase()}:${registryGeneration.slice(0, 16)}`,
    registryGeneration,
  };
}
export class FutureSourceCursorError extends Error {
  constructor(
    public readonly sourceKey: string,
    public readonly cursor: bigint,
    public readonly finalizedHead: bigint,
  ) {
    super(`source cursor ${sourceKey} is ahead of finalized head (${cursor} > ${finalizedHead})`);
    this.name = "FutureSourceCursorError";
  }
}
export function nextCursorStart(input: {
  sourceKey: string;
  deploymentBlock: bigint;
  persistedBlock: bigint | null | undefined;
  finalizedHead: bigint;
}): bigint {
  const persisted = input.persistedBlock;
  if (persisted != null && persisted > input.finalizedHead) {
    throw new FutureSourceCursorError(input.sourceKey, persisted, input.finalizedHead);
  }
  const next = persisted == null ? input.deploymentBlock : persisted + 1n;
  return next < input.deploymentBlock ? input.deploymentBlock : next;
}