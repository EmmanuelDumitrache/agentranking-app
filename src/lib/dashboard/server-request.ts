import { cache } from "react";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDashboardAccess, type DashboardAccessState } from "@/lib/dashboard/access";
import { hasDashboardSessionIdentity } from "@/lib/dashboard/session-identity";
const emptySignedOutAccess: DashboardAccessState = {
  signedIn: false,
  profileId: null,
  ownedAgents: [],
  verifiedAgents: [],
  accountIsVerified: false,
  canManage: false,
  needsVerification: false,
};
export const getCachedDashboardSession = cache(() => getServerSession(authOptions));
export const getCachedDashboardAccess = cache(async () => {
  const session = await getCachedDashboardSession();
  if (!hasDashboardSessionIdentity(session)) {
    return emptySignedOutAccess;
  }
  return getDashboardAccess(session);
});
