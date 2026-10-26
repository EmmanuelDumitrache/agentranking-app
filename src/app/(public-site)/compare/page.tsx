import { ComparePageClient } from "@/components/compare/compare-page-client";
import { readComparePair } from "@/lib/agent-directory/compare.server";
import { parseCompareAgentReference } from "@/lib/compare-agent";

type Props = {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export const dynamic = "force-dynamic";

export default async function ComparePage({ searchParams }: Props) {
  const params = await searchParams;
  const referenceA = parseCompareAgentReference(first(params.a));
  const referenceB = parseCompareAgentReference(first(params.b));
  const initial = referenceA && referenceB
    ? await readComparePair(referenceA, referenceB)
    : { agentA: null, agentB: null };
  return <ComparePageClient initialAgentA={initial.agentA} initialAgentB={initial.agentB} />;
}
