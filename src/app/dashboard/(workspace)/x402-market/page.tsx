import { X402MarketClient } from "@/components/x402-market/x402-market-client";
import { requireDashboardWorkspace } from "@/lib/dashboard/page-auth";
import { searchX402MarketListings } from "@/lib/x402-market/listings.server";
export const dynamic = "force-dynamic";
type PageProps = {
  readonly searchParams?: Promise<{ q?: string | string[] }>;
};
export default async function DashboardX402MarketPage({ searchParams }: PageProps) {
  await requireDashboardWorkspace();
  const params = searchParams ? await searchParams : {};
  const rawQuery = Array.isArray(params.q) ? params.q[0] : params.q;
  const initialQuery = rawQuery?.trim().slice(0, 200) ?? "";
  let initialResult: Awaited<ReturnType<typeof searchX402MarketListings>> | null = null;
  let initialError = "";
  if (initialQuery) {
    try {
      initialResult = await searchX402MarketListings({ q: initialQuery, page: 1 });
    } catch (error) {
      console.error("[dashboard/x402-market] initial search failed", error);
      initialError = "Could not load listings. Try again in a moment.";
    }
  }
  return (
    <X402MarketClient
      initialQuery={initialQuery}
      initialListings={initialResult?.data ?? []}
      initialMeta={initialResult?.meta ?? null}
      initialError={initialError}
    />
  );
}
