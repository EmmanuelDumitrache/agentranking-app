import { AdminVerificationRequestsClient } from "./verification-requests-client";
import { loadAdminPageData } from "@/lib/admin/identity/page-access.server";
import {
  adminVerificationRequestsResourceKey,
  normalizeAdminVerificationRequestsQuery,
} from "@/lib/admin/identity/query";
import { readAdminVerificationRequests } from "@/lib/admin/identity/verification-requests.server";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AdminVerificationRequestsPage({
  searchParams,
}: {
  readonly searchParams: SearchParams;
}) {
  const parsedQuery = normalizeAdminVerificationRequestsQuery(await searchParams);
  const query = {
    ...parsedQuery,
    status: parsedQuery.status === "all" ? "all" : "submitted,in_review",
  };
  const initialData = await loadAdminPageData(() => readAdminVerificationRequests(query));
  return (
    <AdminVerificationRequestsClient
      key={adminVerificationRequestsResourceKey(query)}
      initialData={initialData}
      initialQuery={query}
    />
  );
}
