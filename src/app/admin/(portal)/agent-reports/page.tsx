import { AdminAgentReportsClient } from "./admin-agent-reports-client";
import {
  normalizeAdminAgentReportsInput,
  readAdminAgentReports,
} from "@/lib/admin/operations/agent-reports.server";
import { loadAdminOperationsPage } from "@/lib/admin/operations/page-auth.server";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AdminAgentReportsPage({
  searchParams,
}: {
  readonly searchParams: SearchParams;
}) {
  const params = await searchParams;
  const normalized = normalizeAdminAgentReportsInput({
    page: Number.parseInt(first(params.page) ?? "1", 10),
    perPage: 25,
    status: first(params.status) ?? "open",
  });
  const payload = await loadAdminOperationsPage(() => readAdminAgentReports(normalized));
  return (
    <AdminAgentReportsClient
      initialData={{ reports: payload.reports, total: payload.total }}
      initialPage={normalized.page}
      initialStatus={normalized.status}
    />
  );
}
