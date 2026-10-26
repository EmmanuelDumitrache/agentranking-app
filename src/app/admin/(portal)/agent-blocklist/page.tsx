import { AdminAgentBlocklistClient } from "./admin-agent-blocklist-client";
import { readAdminAgentBlocklist } from "@/lib/admin/operations/agent-blocklist.server";
import { loadAdminOperationsPage } from "@/lib/admin/operations/page-auth.server";

export const dynamic = "force-dynamic";

export default async function AdminAgentBlocklistPage() {
  const { rules } = await loadAdminOperationsPage(readAdminAgentBlocklist);
  return <AdminAgentBlocklistClient initialRules={rules} />;
}
