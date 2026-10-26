import { AdminDaoVotesClient } from "./admin-dao-votes-client";
import { readAdminDaoVotes } from "@/lib/admin/operations/dao-votes.server";
import { loadAdminOperationsPage } from "@/lib/admin/operations/page-auth.server";

export const dynamic = "force-dynamic";

export default async function AdminDaoVotesPage() {
  const { agents } = await loadAdminOperationsPage(() =>
    readAdminDaoVotes({ scope: "board", search: "", limit: 500 }),
  );
  return <AdminDaoVotesClient initialAgents={agents} />;
}
