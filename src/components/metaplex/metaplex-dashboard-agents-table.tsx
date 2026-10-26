"use client";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DEFAULT_METAPLEX_DIRECTORY_FILTERS,
  MetaplexDirectoryFilters,
  type MetaplexDirectoryFilterState,
} from "@/components/metaplex/metaplex-directory-filters";
import { MetaplexAgentCard } from "@/components/metaplex/metaplex-agent-card";
import { MetaplexAgentListRow } from "@/components/metaplex/metaplex-agent-list-row";
import { METAPLEX_EMPTY_INDEX_MESSAGE } from "@/lib/metaplex/config";
import type { MetaplexDashboardAgentRow } from "@/lib/metaplex/types";
import { sortMetaplexDirectoryRows } from "@/lib/metaplex/directory-sort";
import { isMetaplexTradeable } from "@/lib/metaplex/metaplex-ui-helpers";
import { METAPLEX_AGENTS_PATH, METAPLEX_LOGO_SRC } from "@/lib/metaplex/urls";
export type { MetaplexDashboardAgentRow };
function applyClientFilters(
  agents: MetaplexDashboardAgentRow[],
  filters: MetaplexDirectoryFilterState,
): MetaplexDashboardAgentRow[] {
  let rows = [...agents];
  const q = filters.search.trim().toLowerCase();
  if (q) {
    rows = rows.filter((a) => {
      const asset = a.metaplexAssetAddress?.toLowerCase() ?? "";
      const mint = a.metaplexAgentTokenMint?.toLowerCase() ?? "";
      return (
        a.name.toLowerCase().includes(q) ||
        a.slug.toLowerCase().includes(q) ||
        String(a.agentId).includes(q) ||
        asset.includes(q) ||
        mint.includes(q)
      );
    });
  }
  if (filters.tradeable) {
    rows = rows.filter((a) => isMetaplexTradeable(a.metaplex));
  }
  if (filters.boundToken) {
    rows = rows.filter((a) => a.metaplexTokenBindingStatus === "bound");
  }
  if (filters.hasServices) {
    rows = rows.filter((a) => a.serviceCount > 0);
  }
  if (filters.registryDetected) {
    rows = rows.filter((a) => a.metaplexVerified);
  }
  if (filters.active) {
    rows = rows.filter((a) => a.metaplex.active === true);
  }
  return sortMetaplexDirectoryRows(rows, filters.sort);
}
export function MetaplexDashboardAgentsTable({
  agents,
}: {
  readonly agents: MetaplexDashboardAgentRow[];
}) {
  const [filters, setFilters] = useState<MetaplexDirectoryFilterState>(
    DEFAULT_METAPLEX_DIRECTORY_FILTERS,
  );
  const filtered = useMemo(() => applyClientFilters(agents, filters), [agents, filters]);
  let agentsContent: ReactNode;
  if (filtered.length === 0) {
    agentsContent = (
      <p className="px-4 py-6 text-sm text-muted-foreground">{METAPLEX_EMPTY_INDEX_MESSAGE}</p>
    );
  } else if (filters.view === "grid") {
    agentsContent = (
      <div className="grid gap-3 p-3 sm:grid-cols-2 md:p-4">
        {filtered.map((agent) => (
          <MetaplexAgentCard
            key={agent.id}
            agent={{
              id: agent.id,
              agentId: agent.agentId,
              chainId: agent.chainId,
              name: agent.name,
              description: "",
              image: agent.image,
              agentRankScore: agent.agentRankScore,
              profilePath: agent.profilePath,
              metaplexVerified: agent.metaplexVerified,
              metaplexAgentTokenMint: agent.metaplexAgentTokenMint,
              metaplexAssetAddress: agent.metaplexAssetAddress,
              services: [],
            }}
          />
        ))}
      </div>
    );
  } else {
    agentsContent = (
      <div className="divide-y divide-border/35">
        {filtered.map((agent) => (
          <MetaplexAgentListRow
            key={agent.id}
            agent={{
              id: agent.id,
              agentId: agent.agentId,
              chainId: agent.chainId,
              name: agent.name,
              description: agent.description,
              image: agent.image,
              agentRankScore: agent.agentRankScore,
              profilePath: agent.profilePath,
              metaplexVerified: agent.metaplexVerified,
              metaplexAgentTokenMint: agent.metaplexAgentTokenMint,
              metaplexAssetAddress: agent.metaplexAssetAddress,
              listingRegistrySource: "metaplex",
              services: [],
            }}
          />
        ))}
      </div>
    );
  }
  return (
    <Card className="overflow-hidden border-border/70 bg-card/55 shadow-sm">
      <CardHeader className="space-y-3 border-b border-border/35 px-3 py-3 sm:px-4 md:px-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <span className="rounded-lg border border-violet-400/25 bg-violet-500/10 p-1.5">
              <Image
                src={METAPLEX_LOGO_SRC}
                alt=""
                width={16}
                height={16}
                className="h-4 w-4 rounded-sm object-contain"
                unoptimized
              />
            </span>
            <div>
              <CardTitle className="text-sm font-semibold">Indexed agents</CardTitle>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Preview capped at 100 rows for fast browsing.
              </p>
            </div>
          </div>
          <Link
            href={METAPLEX_AGENTS_PATH}
            className="inline-flex h-8 items-center self-start rounded-full border border-violet-400/25 bg-violet-500/10 px-3 text-[11px] font-medium text-violet-200 transition-colors hover:border-violet-300/45 hover:bg-violet-500/15 sm:self-auto"
          >
            Open full directory →
          </Link>
        </div>
        <MetaplexDirectoryFilters
          filters={filters}
          onChange={setFilters}
          resultTotal={filtered.length}
          resultLabel="in preview"
        />
      </CardHeader>
      <CardContent className="p-0">{agentsContent}</CardContent>
    </Card>
  );
}
