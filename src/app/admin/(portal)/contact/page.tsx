import { AdminContactClient } from "./contact-client";
import { readAdminContactInquiries } from "@/lib/admin/identity/contact.server";
import { loadAdminPageData } from "@/lib/admin/identity/page-access.server";
import { adminContactResourceKey, normalizeAdminContactQuery } from "@/lib/admin/identity/query";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AdminContactPage({ searchParams }: { readonly searchParams: SearchParams }) {
  const query = normalizeAdminContactQuery(await searchParams);
  const initialData = await loadAdminPageData(() => readAdminContactInquiries(query));
  return (
    <AdminContactClient
      key={adminContactResourceKey(query)}
      initialData={initialData}
      initialQuery={query}
    />
  );
}
