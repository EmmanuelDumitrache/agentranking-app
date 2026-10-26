import { notFound } from "next/navigation";
import { AdminCreatorDetailClient } from "./creator-detail-client";
import { readAdminCreatorDetail } from "@/lib/admin/identity/creators.server";
import { loadAdminPageData } from "@/lib/admin/identity/page-access.server";

export const dynamic = "force-dynamic";

export default async function AdminCreatorDetailPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const creator = await loadAdminPageData(() => readAdminCreatorDetail(id));
  if (!creator) notFound();
  return <AdminCreatorDetailClient key={id} accountId={id} initialData={creator} />;
}
