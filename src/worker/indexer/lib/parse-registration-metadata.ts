import { compatibleAgentInt, parseCanonicalUnsignedDecimal } from "./exact-protocol.js";
import { LosslessJsonNumber, parseLosslessJson, type LosslessJsonValue } from "./lossless-json.js";
const AGENT_REGISTRY_RE = /^eip155:(0|[1-9][0-9]*):(0x[a-fA-F0-9]{40})$/;
export type RegistrationMetaEntry = {
  agentId?: number;
  chainId?: number;
  agentRegistry?: string;
};
function objectValue(value: LosslessJsonValue): Record<string, LosslessJsonValue> | null {
  return value != null && typeof value === "object" && !Array.isArray(value) && !(value instanceof LosslessJsonNumber)
    ? value
    : null;
}
function unsignedToken(value: LosslessJsonValue | undefined): string | null {
  if (value instanceof LosslessJsonNumber) return value.token;
  if (typeof value === "string") return value;
  return null;
}
function compatibleChainId(value: LosslessJsonValue | undefined): number | null {
  const token = unsignedToken(value);
  if (token == null) return null;
  const parsed = parseCanonicalUnsignedDecimal(token, {
    allowZero: false,
    max: BigInt(Number.MAX_SAFE_INTEGER),
    label: "registration chain id",
  });
  return Number(parsed);
}
/**
 * Decode legacy registrations metadata without JSON number rounding. Entries that
 * cannot be represented by the current compatibility Int schema are ignored
 * rather than linked to a rounded or unrelated deployment.
 */
export function parseRegistrationMetadata(value: string): RegistrationMetaEntry[] {
  try {
    const parsed = parseLosslessJson(value);
    if (!Array.isArray(parsed)) return [];
    const output: RegistrationMetaEntry[] = [];
    for (const item of parsed) {
      const raw = objectValue(item);
      if (!raw) continue;
      const agentToken = unsignedToken(raw.agentId);
      if (agentToken == null) continue;
      const agentId = compatibleAgentInt(agentToken);
      if (agentId == null) continue;
      const sourceRegistry = typeof raw.agentRegistry === "string" ? raw.agentRegistry.trim() : undefined;
      let chainId = compatibleChainId(raw.chainId);
      if (chainId == null && sourceRegistry) {
        const match = AGENT_REGISTRY_RE.exec(sourceRegistry);
        if (match) chainId = compatibleChainId(match[1]);
      }
      output.push({ agentId, chainId: chainId ?? undefined, agentRegistry: sourceRegistry });
    }
    return output;
  } catch {
    return [];
  }
}
