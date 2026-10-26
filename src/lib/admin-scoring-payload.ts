import type { PrismaClient } from "@/generated/prisma/client";
import {
  agentScoringInputFromRow,
  computeAgentScoreLayers,
  computeFinalRankScore,
  type AgentScoreLayers,
} from "@/lib/agent-scoring-layers";
import {
  type AdminScoringLayerKey,
  ADMIN_SCORING_LAYER_KEYS,
  SCORING_LAYER_LABELS,
  SCORING_LAYER_WEIGHT_LABELS,
} from "@/lib/admin-scoring-layer-overrides";
import { mergedScoringLayerOverridesForAgent } from "@/lib/admin-scoring-layer-db";
export type AdminScoringLayerBreakdownRow = {
  key: AdminScoringLayerKey;
  label: string;
  weightLabel: string;
  actual: number;
  display: number;
  overridden: boolean;
};
export type AdminScoringPayload = {
  computedAgentRankScore: number;
  scoringLayerBreakdown: {
    rows: AdminScoringLayerBreakdownRow[];
    formulaAgentRankScore: number;
  };
};
type AgentRow = Parameters<typeof agentScoringInputFromRow>[0] & {
  metadata?: Array<{ key: string; value: string }>;
};
export function applyScoringLayerOverrides(
  layers: AgentScoreLayers,
  overrides: Partial<Record<AdminScoringLayerKey, number>>,
): AgentScoreLayers & { agentRankScore: number } {
  const profile = {
    ...layers.profile,
    score: overrides.profile ?? layers.profile.score,
  };
  const protocolTrust = {
    ...layers.protocolTrust,
    score: overrides.protocolTrust ?? layers.protocolTrust.score,
  };
  const reputation = {
    ...layers.reputation,
    score: overrides.reputation ?? layers.reputation.score,
  };
  const activity = {
    ...layers.activity,
    score: overrides.activity ?? layers.activity.score,
  };
  const agentRankScore = computeFinalRankScore({
    profile: profile.score,
    protocolTrust: protocolTrust.score,
    reputation: reputation.score,
    activity: activity.score,
  });
  return {
    ...layers,
    profile,
    protocolTrust,
    reputation,
    activity,
    agentRankScore,
  };
}
export async function buildAdminScoringPayload(
  db: Pick<PrismaClient, "$queryRaw">,
  agentPk: number,
  agent: AgentRow,
): Promise<AdminScoringPayload> {
  const layerOverrides = await mergedScoringLayerOverridesForAgent(
    db,
    agentPk,
    agent.metadata,
  );
  const input = agentScoringInputFromRow(agent);
  const baseLayers = computeAgentScoreLayers(input);
  const displayLayers = applyScoringLayerOverrides(baseLayers, layerOverrides);
  return {
    computedAgentRankScore: displayLayers.agentRankScore,
    scoringLayerBreakdown: {
      rows: ADMIN_SCORING_LAYER_KEYS.map((key) => ({
        key,
        label: SCORING_LAYER_LABELS[key],
        weightLabel: SCORING_LAYER_WEIGHT_LABELS[key],
        actual: Math.round(baseLayers[key].score),
        display: Math.round(displayLayers[key].score),
        overridden: layerOverrides[key] !== undefined,
      })),
      formulaAgentRankScore: displayLayers.agentRankScore,
    },
  };
}
/** Persist layer columns + composite agentRankScore from formula + overrides. */
export function prismaDataFromScoringLayers(
  layers: AgentScoreLayers & { agentRankScore: number },
): {
  score: number;
  protocolTrustScore: number;
  activityScore: number;
  agentRankScore: number;
  executionScore: number;
} {
  return {
    score: layers.profile.score,
    protocolTrustScore: layers.protocolTrust.score,
    activityScore: layers.activity.score,
    agentRankScore: layers.agentRankScore,
    executionScore: layers.protocolTrust.executionScore ?? 0,
  };
}
