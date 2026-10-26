import { loadAdminOperationsPage } from "@/lib/admin/operations/page-auth.server";
import { readAdminMcpOperations } from "@/lib/admin/operations/mcp-policies.server";
import { AdminMcpOperationsClient } from "./admin-mcp-operations-client";

export const dynamic = "force-dynamic";

export default async function AdminMcpOperationsPage() {
  const initialData = await loadAdminOperationsPage(readAdminMcpOperations);
  return <AdminMcpOperationsClient initialData={initialData} />;
}
