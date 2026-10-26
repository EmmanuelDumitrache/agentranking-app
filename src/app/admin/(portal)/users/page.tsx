import { AdminUsersClient } from "./users-client";
import { loadAdminPageData } from "@/lib/admin/identity/page-access.server";
import { adminUsersResourceKey, normalizeAdminUsersQuery } from "@/lib/admin/identity/query";
import { readAdminUsers } from "@/lib/admin/identity/users.server";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AdminUsersPage({ searchParams }: { readonly searchParams: SearchParams }) {
  const query = normalizeAdminUsersQuery(await searchParams);
  const initialData = await loadAdminPageData(() => readAdminUsers(query));
  return (
    <AdminUsersClient
      key={adminUsersResourceKey(query)}
      initialData={initialData}
      initialQuery={query}
    />
  );
}
