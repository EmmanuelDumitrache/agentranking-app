const POSTGRES_INT_MIN = -2_147_483_648;
const POSTGRES_INT_MAX = 2_147_483_647;
const CHAIN_ID_PATTERN = /^[1-9]\d*$/;
const AGENT_ID_PATTERN = /^-?\d+$/;

function parsePostgresInt(raw: string, pattern: RegExp): number | null {
  if (!pattern.test(raw)) return null;
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) return null;
  if (value < POSTGRES_INT_MIN || value > POSTGRES_INT_MAX) return null;
  // Public paths have one textual representation per numeric identity. Reject
  // aliases such as 0007 and -0 rather than allowing duplicate indexable URLs.
  if (raw !== String(value)) return null;
  return value;
}

export function parsePublicChainId(raw: string): number | null {
  const value = parsePostgresInt(raw, CHAIN_ID_PATTERN);
  return value != null && value > 0 ? value : null;
}

export function parsePublicAgentId(raw: string): number | null {
  return parsePostgresInt(raw, AGENT_ID_PATTERN);
}
