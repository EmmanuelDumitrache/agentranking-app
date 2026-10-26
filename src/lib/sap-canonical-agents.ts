import { resolveImageUrl } from "@/lib/image-utils";
/** Raw SAP agent row before canonical deduplication. */
export type SapAgentRowInput = {
  chainId: number;
  agentId: number;
  name: string;
  score: number;
  image: string | null;
  sapAgentPda: string | null;
  sapOwnerWallet: string | null;
  sapRegisteredAt: Date | string | null;
  createdAt: Date | string;
  listedAt: Date | string;
};
export type SapCanonicalAgentRow = {
  chainId: number;
  agentId: number;
  name: string;
  score: number;
  image: string;
  sapAgentPda: string | null;
  sapOwnerWallet: string | null;
  sapRegisteredAt: string | null;
  createdAt: string;
  listedAt: string;
  /** Duplicate indexed rows sharing the same authoritative SAP Agent PDA. */
  alternatePdaCount: number;
  alternateAgentIds: Array<{ chainId: number; agentId: number }>;
};
function toIso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : v;
}
function hasResolvableImage(image: string | null | undefined): boolean {
  return Boolean(resolveImageUrl(image));
}
function registeredAtMs(v: Date | string | null): number {
  if (v == null) return 0;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isFinite(t) ? t : 0;
}
/** Prefer row with image, then higher score, then newer SAP registration. */
export function pickCanonicalSapAgent<T extends SapAgentRowInput>(a: T, b: T): T {
  const aImg = hasResolvableImage(a.image);
  const bImg = hasResolvableImage(b.image);
  if (aImg !== bImg) return aImg ? a : b;
  const scoreDiff = a.score - b.score;
  if (scoreDiff !== 0) return scoreDiff > 0 ? a : b;
  const regDiff = registeredAtMs(a.sapRegisteredAt) - registeredAtMs(b.sapRegisteredAt);
  if (regDiff !== 0) return regDiff > 0 ? a : b;
  const listedDiff = registeredAtMs(a.listedAt) - registeredAtMs(b.listedAt);
  if (listedDiff !== 0) return listedDiff > 0 ? a : b;
  return a.agentId <= b.agentId ? a : b;
}
function sapIdentityKey(agent: Pick<SapAgentRowInput, "chainId" | "agentId" | "sapAgentPda">): string {
  const pda = agent.sapAgentPda?.trim();
  return pda ? `pda:${pda}` : `agent:${agent.chainId}:${agent.agentId}`;
}
export function countUniqueSapIdentities(
  agents: Array<Pick<SapAgentRowInput, "chainId" | "agentId" | "sapAgentPda">>,
): number {
  return new Set(agents.map(sapIdentityKey)).size;
}
export function dedupeSapAgentsByIdentity(agents: SapAgentRowInput[]): SapCanonicalAgentRow[] {
  const byIdentity = new Map<string, SapAgentRowInput[]>();
  for (const agent of agents) {
    const key = sapIdentityKey(agent);
    const group = byIdentity.get(key);
    if (group) group.push(agent);
    else byIdentity.set(key, [agent]);
  }
  const out: SapCanonicalAgentRow[] = [];
  for (const group of byIdentity.values()) {
    let canonical = group[0]!;
    for (let i = 1; i < group.length; i++) {
      canonical = pickCanonicalSapAgent(canonical, group[i]!);
    }
    const alternates = group.filter(
      (row) => row.chainId !== canonical.chainId || row.agentId !== canonical.agentId,
    );
    const resolvedImage = resolveImageUrl(canonical.image) ?? canonical.image?.trim() ?? "";
    out.push({
      chainId: canonical.chainId,
      agentId: canonical.agentId,
      name: canonical.name,
      score: canonical.score,
      image: resolvedImage,
      sapAgentPda: canonical.sapAgentPda,
      sapOwnerWallet: canonical.sapOwnerWallet?.trim() || null,
      sapRegisteredAt: canonical.sapRegisteredAt ? toIso(canonical.sapRegisteredAt) : null,
      createdAt: toIso(canonical.createdAt),
      listedAt: toIso(canonical.listedAt),
      alternatePdaCount: alternates.length,
      alternateAgentIds: alternates.map((row) => ({ chainId: row.chainId, agentId: row.agentId })),
    });
  }
  out.sort((a, b) => {
    const scoreDiff = b.score - a.score;
    if (scoreDiff !== 0) return scoreDiff;
    return registeredAtMs(b.sapRegisteredAt) - registeredAtMs(a.sapRegisteredAt);
  });
  return out;
}
