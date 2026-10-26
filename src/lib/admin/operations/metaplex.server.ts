import "server-only";

import { getSession } from "@/lib/admin-auth";
import { loadMetaplexDebugStats, type MetaplexDebugStats } from "@/lib/metaplex/debug-stats";
import { buildMetaplexOpsStatus, type MetaplexOpsStatus } from "@/lib/metaplex/ops-status";
import type { AdminMetaplexHubState } from "./metaplex-types";
import { requireAdminOperationsSession } from "./auth.server";

export async function readAdminMetaplexOpsStatus(): Promise<MetaplexOpsStatus> {
  await requireAdminOperationsSession();
  return buildMetaplexOpsStatus();
}

export async function readAdminMetaplexDebugStats(): Promise<MetaplexDebugStats> {
  await requireAdminOperationsSession();
  return loadMetaplexDebugStats();
}

export async function readAdminMetaplexHubState(): Promise<AdminMetaplexHubState> {
  await requireAdminOperationsSession();
  const [opsStatus, debugStats] = await Promise.all([
    Promise.resolve(buildMetaplexOpsStatus()),
    loadMetaplexDebugStats(),
  ]);
  return { isAdmin: true, opsStatus, debugStats };
}

/** Safe for public Server Components: signed-out visitors receive no admin data. */
export async function readOptionalAdminMetaplexHubState(): Promise<AdminMetaplexHubState> {
  const session = await getSession();
  if (!session) return { isAdmin: false, opsStatus: null, debugStats: null };
  const [opsStatus, debugStats] = await Promise.all([
    Promise.resolve(buildMetaplexOpsStatus()),
    loadMetaplexDebugStats(),
  ]);
  return { isAdmin: true, opsStatus, debugStats };
}
