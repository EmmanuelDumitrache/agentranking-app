import { buildSeoMetadata } from "@/lib/seo";
import { SOCIAL_PAGE_SUBTITLE, SOCIAL_PAGE_TITLE } from "@/lib/social-page-config";
import { SocialPageClient } from "@/components/social/social-page-client";
import { parseSocialFilter } from "@/lib/social-profiles-query";
import { readSocialPageSnapshot } from "@/lib/social/social-page.server";
export const metadata = buildSeoMetadata({
  path: "/social",
  title: `${SOCIAL_PAGE_TITLE} | AgentRanking`,
  description: SOCIAL_PAGE_SUBTITLE,
});
type Props = {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
};
function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}
export const dynamic = "force-dynamic";
export default async function SocialPage({ searchParams }: Props) {
  const params = await searchParams;
  const filter = parseSocialFilter(first(params.filter));
  const q = first(params.q).trim().slice(0, 120);
  const page = 1;
  const snapshot = await readSocialPageSnapshot({ page, perPage: 20, filter, q });
  return (
    <SocialPageClient
      initialPage={snapshot.initialPage}
      initialFeatured={snapshot.featured}
      initialViewer={snapshot.viewer}
      initialFilter={filter}
      initialSearch={q}
    />
  );
}
