import "server-only";

import type { Session } from "next-auth";
import { assertDashboardAgentAccess } from "@/lib/dashboard/access";
import { getDashboardUserProfile } from "@/lib/dashboard/session-profile";
import { ensureAppAccountForProfile } from "@/lib/custodial-wallet/bootstrap";

export type DashboardMcpAccess =
  | { ok: true; appAccountId: string; actorProfileId: number }
  | { ok: false; status: 401 | 403 | 404 };

export async function assertDashboardMcpAccountAccess(
  session: Session | null,
): Promise<DashboardMcpAccess> {
  const profile = await getDashboardUserProfile(session);
  if (!profile) return { ok: false, status: session ? 403 : 401 };
  const account = await ensureAppAccountForProfile({
    id: profile.id,
    displayName: profile.displayName,
    email: profile.email,
    avatarUrl: profile.avatarUrl,
  });
  return { ok: true, appAccountId: account.id, actorProfileId: profile.id };
}

export async function assertDashboardMcpAccess(
  session: Session | null,
  agentDbId: number,
): Promise<DashboardMcpAccess> {
  const access = await assertDashboardAgentAccess(session, agentDbId);
  if (!access.ok) return access;
  return await assertDashboardMcpAccountAccess(session);
}
