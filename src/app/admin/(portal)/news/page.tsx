import { AdminNewsClient } from "./admin-news-client";
import { readAdminNewsArticles } from "@/lib/admin/operations/news.server";
import { loadAdminOperationsPage } from "@/lib/admin/operations/page-auth.server";

export const dynamic = "force-dynamic";

export default async function AdminNewsPage() {
  const initialData = await loadAdminOperationsPage(readAdminNewsArticles);
  return <AdminNewsClient initialData={initialData} />;
}
