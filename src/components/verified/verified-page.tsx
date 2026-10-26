"use client";
import { useInfiniteQuery } from "@tanstack/react-query";
import { PublicSitePageShell } from "@/components/public-site/public-site-page-shell";
import { VerifiedPageHeader } from "@/components/verified/verified-page-header";
import { VerifiedVerificationPanel } from "@/components/verified/verified-verification-panel";
import { VerifiedDirectoryTable } from "@/components/verified/verified-directory-table";
import { VerifiedReferralFooter } from "@/components/verified/verified-referral-footer";
import {
  VERIFIED_DIRECTORY_PAGE_SIZE,
  type VerifiedDirectoryPageData,
  verifiedDirectoryQueryKey,
} from "@/lib/agent-directory/verified-directory";
const PER_PAGE = VERIFIED_DIRECTORY_PAGE_SIZE;
class VerifiedPageRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "VerifiedPageRequestError";
  }
}
async function fetchVerifiedPage(page: number, signal: AbortSignal): Promise<VerifiedDirectoryPageData> {
  const res = await fetch(
    `/api/verified?perPage=${PER_PAGE}&page=${page}`,
    { cache: "no-store", signal },
  );
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const rec = body as { error?: string; hint?: string };
    const detail = typeof rec.error === "string" ? rec.error : `Request failed (${res.status})`;
    let hint = "";
    if (typeof rec.hint === "string") {
      hint = ` ${rec.hint}`;
    } else if (res.status === 503) {
      hint =
        " For local development, run pnpm dev with local PostgreSQL and Valkey configured in .env.local.";
    }
    throw new VerifiedPageRequestError(res.status, `${detail}.${hint}`);
  }
  const data = body as Omit<VerifiedDirectoryPageData, "page" | "perPage" | "generatedAt"> & Partial<Pick<VerifiedDirectoryPageData, "page" | "perPage" | "generatedAt">>;
  return {
    ...data,
    page: data.page ?? page,
    perPage: data.perPage ?? PER_PAGE,
    generatedAt: data.generatedAt ?? new Date().toISOString(),
  };
}
function shouldRetryVerifiedPage(failureCount: number, error: Error): boolean {
  if (failureCount >= 1) return false;
  return (
    (error instanceof VerifiedPageRequestError && error.status === 503) ||
    error instanceof TypeError
  );
}
export function VerifiedPage({ initialData }: { readonly initialData: VerifiedDirectoryPageData }) {
  const query = useInfiniteQuery({
    queryKey: verifiedDirectoryQueryKey(PER_PAGE),
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => fetchVerifiedPage(pageParam, signal),
    getNextPageParam: (lastPage) =>
      lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined,
    initialData: { pages: [initialData], pageParams: [initialData.page] },
    initialDataUpdatedAt: Date.parse(initialData.generatedAt),
    refetchOnMount: false,
    retry: shouldRetryVerifiedPage,
    retryDelay: (attemptIndex) => {
      const ceiling = Math.min(3_000, 1_500 * 2 ** attemptIndex);
      return Math.floor(ceiling * (0.5 + Math.random() * 0.5));
    },
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
  const pages = query.data?.pages ?? [];
  const fetchedAgents = pages.flatMap((page) => page.agents ?? []);
  const agents = fetchedAgents;
  const latestPage = pages.at(-1);
  const total = latestPage?.total ?? 0;
  const error = query.error instanceof Error ? query.error.message : null;
  return (
    <PublicSitePageShell className="verified-page-shell">
      <div className="verified-page">
        <VerifiedPageHeader />
        <VerifiedVerificationPanel />
        <VerifiedDirectoryTable
          agents={agents}
          total={total}
          loading={query.isPending}
          loadingMore={query.isFetchingNextPage}
          error={error}
          hasMore={Boolean(query.hasNextPage)}
          onRetry={() => void query.refetch()}
          onLoadMore={() => void query.fetchNextPage()}
        />
        <VerifiedReferralFooter />
      </div>
    </PublicSitePageShell>
  );
}
