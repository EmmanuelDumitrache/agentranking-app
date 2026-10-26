export const AGENT_URL_SLUG_VERSION = 1;
export const AGENT_URL_SLUG_MAX_CODE_POINTS = 80;

const CONTROL_AND_FORMAT = /[\p{Cc}\p{Cf}]/gu;
const APOSTROPHE_LIKE = /['’‘ʼ＇`´]/gu;
const NON_LETTER_OR_DECIMAL = /[^\p{L}\p{Nd}]+/gu;
const REPEATED_HYPHENS = /-+/g;
const EDGE_HYPHENS = /^-+|-+$/g;

export interface AgentPublicLinkInput {
  chainId: number;
  agentId: number;
  name: string;
}

export interface AgentPublicLink {
  chainId: number;
  agentId: number;
  slug: string;
  profilePath: string;
  profileUrl?: string;
}

const POSTGRES_INT_MIN = -2_147_483_648;
const POSTGRES_INT_MAX = 2_147_483_647;

function assertPostgresInt(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) throw new TypeError(`${label} must be a safe integer`);
  if (value < POSTGRES_INT_MIN || value > POSTGRES_INT_MAX) {
    throw new RangeError(`${label} must fit a PostgreSQL Int`);
  }
}

export function toAgentUrlSlug(name: string): string {
  const normalized = String(name)
    .normalize("NFKC")
    .replace(CONTROL_AND_FORMAT, "")
    .toLowerCase()
    .replace(APOSTROPHE_LIKE, "")
    .replace(NON_LETTER_OR_DECIMAL, "-")
    .replace(REPEATED_HYPHENS, "-")
    .replace(EDGE_HYPHENS, "");

  const truncated = Array.from(normalized)
    .slice(0, AGENT_URL_SLUG_MAX_CODE_POINTS)
    .join("")
    .replace(/-+$/g, "");

  return truncated || "agent";
}

export function agentPublicPath(input: AgentPublicLinkInput): string {
  assertPostgresInt(input.chainId, "chainId");
  assertPostgresInt(input.agentId, "agentId");
  if (input.chainId <= 0) throw new RangeError("chainId must be positive");
  const slug = encodeURIComponent(toAgentUrlSlug(input.name));
  return `/agents/${input.chainId}/${input.agentId}/${slug}`;
}

export function agentPublicUrl(origin: string, input: AgentPublicLinkInput): string {
  const base = new URL(origin);
  return new URL(agentPublicPath(input), base).toString();
}

export function buildAgentPublicLink(
  input: AgentPublicLinkInput,
  origin?: string,
): AgentPublicLink {
  const slug = toAgentUrlSlug(input.name);
  const profilePath = agentPublicPath(input);
  return {
    chainId: input.chainId,
    agentId: input.agentId,
    slug,
    profilePath,
    ...(origin ? { profileUrl: agentPublicUrl(origin, input) } : {}),
  };
}
