import { assessFairscaleAgent } from "@/lib/fairscale/assess.server";
import { runFairscaleSync } from "@/lib/fairscale/sync.server";

export const fairscaleScanJob = runFairscaleSync;
export const fairscaleAssessmentJob = assessFairscaleAgent;
