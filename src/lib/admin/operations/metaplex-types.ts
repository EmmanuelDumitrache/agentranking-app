import type { MetaplexDebugStats } from "@/lib/metaplex/debug-stats";
import type { MetaplexOpsStatus } from "@/lib/metaplex/ops-status";

export type AdminMetaplexHubState = {
  readonly isAdmin: boolean;
  readonly opsStatus: MetaplexOpsStatus | null;
  readonly debugStats: MetaplexDebugStats | null;
};
