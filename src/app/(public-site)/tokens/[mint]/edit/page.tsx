import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/db";
import { authOptions } from "@/lib/auth";
import { serializeAgentLaunch } from "@/lib/agent-launch/serialize";
import { LaunchProfileEditForm } from "@/components/agent-launch/launch-profile-edit-form";
import {
  assertAgentLaunchDraftAccess,
  loadLaunchAccessContext,
} from "@/lib/launch-wallet-session/auth";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ mint: string }> };
export default async function LaunchProfileEditPage({ params }: Props) {
  const { mint } = await params;
  const launch = await prisma.agentLaunch.findUnique({ where: { mint } });
  if (
    !launch ||
    launch.network !== "devnet" ||
    launch.launchStatus !== "indexed" ||
    launch.feeSharingStatus !== "active"
  ) {
    notFound();
  }
  const session = await getServerSession(authOptions);
  const access = await assertAgentLaunchDraftAccess(
    launch,
    await loadLaunchAccessContext(session),
  );
  if (!access.ok) notFound();
  return <LaunchProfileEditForm launch={serializeAgentLaunch(launch)} />;
}
