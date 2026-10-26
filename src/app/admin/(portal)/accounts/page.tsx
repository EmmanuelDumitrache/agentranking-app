import { AdminAccountsClient } from "./accounts-client";
import { readAdminAccounts } from "@/lib/admin/identity/accounts.server";
import { loadAdminPageData } from "@/lib/admin/identity/page-access.server";
import { adminAccountsResourceKey, normalizeAdminAccountsQuery } from "@/lib/admin/identity/query";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AdminAccountsPage({ searchParams }: { readonly searchParams: SearchParams }) {
  const query = normalizeAdminAccountsQuery(await searchParams);
  const initialData = await loadAdminPageData(() => readAdminAccounts(query));
  return (
    <AdminAccountsClient
      key={adminAccountsResourceKey(query)}
      initialData={initialData}
      initialQuery={query}
    />
  );
}
