import { createHash } from "node:crypto";
import { parseRegistrationMetadata, type RegistrationMetaEntry } from "@/lib/agent-identity";
import { fetchAgentRegistrationJson } from "@/lib/fetch-agent-registration";
import { extractIpfsPath } from "@/lib/ipfs/uri";
import { valkeyGetJson, valkeySetJson } from "@/lib/valkey";

const REMOTE_FETCH_TIMEOUT_MS = 4_000;
const REMOTE_CACHE_REVALIDATE_SEC = 300;

function isSupportedRemoteAgentUri(uri: string): boolean {
  return uri.startsWith("https://") || Boolean(extractIpfsPath(uri));
}

function remoteAgentUriCacheKey(uri: string): string {
  const digest = createHash("sha256").update(uri).digest("hex");
  return `agent-uri-remote:v1:${digest}`;
}

/** Fetch ERC-8004 registration JSON from HTTPS or IPFS through the controlled Kubo RPC. */
export async function fetchRemoteAgentUriRegistrations(
  agentURI: string | null | undefined,
): Promise<RegistrationMetaEntry[]> {
  const uri = agentURI?.trim();
  if (!uri || !isSupportedRemoteAgentUri(uri)) return [];

  const key = remoteAgentUriCacheKey(uri);
  let parsed = await valkeyGetJson<Record<string, unknown>>(key);
  if (parsed === null) {
    const loaded = await fetchAgentRegistrationJson(uri, REMOTE_FETCH_TIMEOUT_MS);
    if (loaded && typeof loaded === "object" && !Array.isArray(loaded)) {
      parsed = loaded as Record<string, unknown>;
      await valkeySetJson(key, parsed, REMOTE_CACHE_REVALIDATE_SEC);
    }
  }
  if (!parsed) return [];
  const registrations = parsed.registrations;
  if (!Array.isArray(registrations)) return [];
  return parseRegistrationMetadata(JSON.stringify(registrations));
}
