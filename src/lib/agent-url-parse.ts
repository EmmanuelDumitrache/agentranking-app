import { parsePublicAgentId, parsePublicChainId } from "@/lib/agent-public-identity";

export type ParsedAgentPublicUrl = {
  chainId: number;
  agentId: number;
  slug: string;
};

function decodeSegment(value: string): string | null {
  if (value.length === 0 || value.length > 1_536) return null;
  try {
    const decoded = decodeURIComponent(value);
    if (!decoded || Array.from(decoded).length > 512) return null;
    if (decoded.includes("/") || decoded.includes("\\")) return null;
    if (/[\p{Cc}\p{Cf}]/u.test(decoded)) return null;
    return decoded;
  } catch {
    return null;
  }
}

/** Parse only the complete canonical Agent profile shape. */
export function parseAgentFromUrl(input: string): ParsedAgentPublicUrl | null {
  const raw = String(input ?? "").trim();
  if (!raw || raw.length > 4_096) return null;
  const isAbsoluteHttpUrl = /^https?:\/\//i.test(raw);
  if (!isAbsoluteHttpUrl && (!raw.startsWith("/") || raw.startsWith("//"))) return null;

  let url: URL;
  try {
    url = new URL(raw, "https://agentranking.invalid");
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;

  // Preserve empty segments so repeated and trailing slashes are rejected.
  // The sole accepted pathname is exactly /agents/{chainId}/{agentId}/{slug}.
  const segments = url.pathname.split("/");
  if (
    segments.length !== 5 ||
    segments[0] !== "" ||
    segments[1] !== "agents" ||
    segments.some((segment, index) => index > 0 && segment.length === 0)
  ) return null;

  // Numeric identity segments have one literal canonical representation; percent-encoded
  // digits/signs would create aliases that the central path builder never emits.
  if (segments[2]!.includes("%") || segments[3]!.includes("%")) return null;

  const chainSegment = decodeSegment(segments[2]);
  const agentSegment = decodeSegment(segments[3]);
  const slug = decodeSegment(segments[4]);
  if (chainSegment == null || agentSegment == null || slug == null) return null;

  const chainId = parsePublicChainId(chainSegment);
  const agentId = parsePublicAgentId(agentSegment);
  if (chainId == null || agentId == null) return null;

  return { chainId, agentId, slug };
}
