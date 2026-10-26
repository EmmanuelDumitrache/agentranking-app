import { getPublicSiteUrl, getAppProductSiteUrl, getStakeSiteUrl } from "@/lib/site-url";
export const SOCIAL_OG_IMAGE_PATHS = {
  home: "/og/social/home.png",
  ranking: "/og/social/ranking.png",
  agents: "/og/social/agents.png",
  tokens: "/og/social/tokens.png",
  robinhoodTokens: "/og/social/robinhood-tokens.png",
  staking: "/og/social/staking.png",
  jobs: "/og/social/jobs.png",
  docs: "/og/social/docs.png",
  news: "/og/social/news.png",
  agentDashboard: "/og/social/agent-dashboard.png",
} as const;
export type SocialOgImageKey = keyof typeof SOCIAL_OG_IMAGE_PATHS;
export function publicSiteSocialOgImageUrl(key: SocialOgImageKey): string {
  return `${getPublicSiteUrl()}${SOCIAL_OG_IMAGE_PATHS[key]}`;
}
export function appSocialOgImageUrl(key: SocialOgImageKey): string {
  return `${getAppProductSiteUrl()}${SOCIAL_OG_IMAGE_PATHS[key]}`;
}
export function stakeSocialOgImageUrl(): string {
  return `${getStakeSiteUrl()}${SOCIAL_OG_IMAGE_PATHS.staking}`;
}
export function agentSocialOgImageUrl(chainId: number, agentId: number): string {
  return `${getPublicSiteUrl()}/api/og/agent/${encodeURIComponent(chainId)}/${encodeURIComponent(agentId)}`;
}
export function tokenSocialOgImageUrl(mint: string): string {
  return `${getPublicSiteUrl()}/api/og/token/${encodeURIComponent(mint)}`;
}
export function robinhoodTokenSocialOgImageUrl(address: string): string {
  return `${getPublicSiteUrl()}/api/og/token/robinhood/${encodeURIComponent(address)}`;
}
export function socialOgImageMetadata(url: string, alt: string) {
  return {
    url,
    width: 1200,
    height: 630,
    alt,
  } as const;
}
