/**
 * Curated official project tokens surfaced on the public /tokens page.
 *
 * These are NOT AgentRanking-launched tokens (no AgentLaunch DB record).
 * They are pinned first and rendered with premium styling to distinguish
 * them from user-launched tokenized agents.
 */
export type OfficialPublicToken = {
  kind: "official_project_token";
  mint: string;
  network: "mainnet-beta";
  name: string;
  symbol: string;
  description: string;
  imageUrl: string | null;
  websiteUrl: string | null;
  xUrl: string | null;
  telegramUrl: string | null;
  isOfficial: true;
  badgeLabel: string;
};
export const OFFICIAL_PUBLIC_TOKENS: OfficialPublicToken[] = [
  {
    kind: "official_project_token",
    mint: "92eXvBFGBAXwgmPf6t6CUCNJH2xChsCJuWzaGPjyPUmP",
    network: "mainnet-beta",
    name: "AgentRanking",
    symbol: "AR",
    description: "The official AgentRanking ecosystem token.",
    imageUrl: "/ar-mark.png",
    websiteUrl: "https://agentranking.io",
    xUrl: "https://x.com/agentranking",
    telegramUrl: null,
    isOfficial: true,
    badgeLabel: "Official AgentRanking Token",
  },
];
export function getOfficialPublicToken(mint: string): OfficialPublicToken | null {
  return OFFICIAL_PUBLIC_TOKENS.find((t) => t.mint === mint) ?? null;
}
