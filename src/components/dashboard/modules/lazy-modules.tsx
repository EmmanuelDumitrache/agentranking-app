import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
export const DashboardGithubModule = dynamic(
  () => import("@/components/dashboard/github/github-panel"),
  {
    loading: () => (
      <div className="text-muted-foreground flex items-center gap-2 p-4 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Loading GitHub…
      </div>
    ),
  },
);
export const DashboardServicesModule = dynamic(
  () => import("@/components/dashboard/services/services-agent-edit"),
  {
    loading: () => (
      <div className="text-muted-foreground flex items-center gap-2 p-4 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Loading services…
      </div>
    ),
  },
);
export const DashboardHealthModule = dynamic(
  () => import("@/components/dashboard/activity/agent-activity-feed"),
  {
    loading: () => (
      <div className="text-muted-foreground flex items-center gap-2 p-4 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Loading activity…
      </div>
    ),
  },
);
