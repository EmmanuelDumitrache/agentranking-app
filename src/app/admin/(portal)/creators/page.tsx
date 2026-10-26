import { AdminCreatorsClient } from "./creators-client";
import { readAdminCreators } from "@/lib/admin/identity/creators.server";
import { loadAdminPageData } from "@/lib/admin/identity/page-access.server";
import { adminCreatorsResourceKey, normalizeAdminCreatorsQuery } from "@/lib/admin/identity/query";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AdminCreatorsPage({ searchParams }: { readonly searchParams: SearchParams }) {
  const query = normalizeAdminCreatorsQuery(await searchParams);
  const initialData = await loadAdminPageData(() => readAdminCreators(query));
  return (
    <AdminCreatorsClient
      key={adminCreatorsResourceKey(query)}
      initialData={initialData}
      initialQuery={query}
    />
  );
}
