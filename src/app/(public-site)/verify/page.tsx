import { VerifiedPage } from "@/components/verified/verified-page";
import { readVerifiedDirectoryPage } from "@/lib/agent-directory/verified-directory.server";

/** Alias for the public verification page (`/verified`) — keeps /verify working. */
export const dynamic = "force-dynamic";

export default async function VerifyRoutePage() {
  const initialData = await readVerifiedDirectoryPage();
  return <VerifiedPage initialData={initialData} />;
}
