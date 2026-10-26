import { permanentRedirect } from "next/navigation";
import type { PublicRankingSearchParams } from "@/lib/ranking/public-ranking.server";

type Props = {
  readonly searchParams: Promise<PublicRankingSearchParams>;
};

export default async function RankingRedirectPage({ searchParams }: Props) {
  const raw = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    const token = Array.isArray(value) ? value[0] : value;
    if (token) params.set(key, token);
  }
  const query = params.toString();
  permanentRedirect(query ? `/agents?${query}` : "/agents");
}
