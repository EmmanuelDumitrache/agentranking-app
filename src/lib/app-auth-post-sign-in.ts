import {
  DEFAULT_APP_POST_LOGIN_PATH,
  appMfaUrl,
  normalizeAppCallbackPath,
} from "@/lib/app-auth-routes";
import { pickNewestOwnedAgentId } from "@/lib/dashboard/default-agent";
import { defaultDashboardAgentPath } from "@/lib/dashboard/navigation";
import {
  getCachedDashboardAccess,
  getCachedDashboardSession,
} from "@/lib/dashboard/server-request";
function isDefaultDashboardDestination(path: string): boolean {
  const normalized =
    path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path || "/";
  return normalized === "/" || normalized === DEFAULT_APP_POST_LOGIN_PATH;
}
/** After sign-in, land on agent overview when the user already has agents. */
export async function resolvePostSignInDestination(
  next: string | readonly string[] | null | undefined,
): Promise<string> {
  const nextHref = normalizeAppCallbackPath(next);
  const session = await getCachedDashboardSession();
  if (session?.user?.mfaVerified === false) {
    return appMfaUrl(nextHref);
  }
  if (!isDefaultDashboardDestination(nextHref)) return nextHref;
  const access = await getCachedDashboardAccess();
  if (!access.signedIn) return nextHref;
  const agentId = pickNewestOwnedAgentId(access.ownedAgents);
  if (agentId != null) return defaultDashboardAgentPath(agentId);
  return nextHref;
}
