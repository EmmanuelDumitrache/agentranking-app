import { AdminVerifiedAgentsClient } from "./verified-agents-client";
import {
  normalizeAdminVerifiedAgentsInput,
  readAdminVerifiedAgents,
} from "@/lib/admin/operations/verified-agents.server";
import { loadAdminOperationsPage } from "@/lib/admin/operations/page-auth.server";
export const dynamic = "force-dynamic";
type SearchParams = Promise<Record<string, string | string[] | undefined>>;
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
export default async function AdminVerifiedAgentsPage({
  searchParams,
}: {
  readonly searchParams: SearchParams;
}) {
  const params = await searchParams;
  const query = normalizeAdminVerifiedAgentsInput({
    page: Number.parseInt(first(params.page) ?? "1", 10),
    perPage: 25,
    search: first(params.search),
    filter: first(params.filter),
  });
  const initialData = await loadAdminOperationsPage(() =>
    readAdminVerifiedAgents(query),
  );
  return (
    <AdminVerifiedAgentsClient
      initialQuery={{
        filter: query.filter,
        search: query.search,
        page: query.page,
      }}
      initialData={initialData}
    />
  );
}
