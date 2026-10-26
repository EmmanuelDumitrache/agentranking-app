import type { AgentRiskRecommendation } from "@/lib/verification/oracle-agent-risk";
import type { IssuingAuthorizationWebhookInput } from "./providers/types";

export interface AuthorizationEvaluationInput {
  webhook: IssuingAuthorizationWebhookInput;
  agentId: number | null;
  risk: AgentRiskRecommendation;
  todaySpendCents: number;
}

export interface AuthorizationEvaluationResult {
  approved: boolean;
  declineReason?: string;
  riskTierChecked: boolean;
  policyChecked: boolean;
  notes: string[];
}

/**
 * Real-time authorization decision — oracle tier limit + same-day spend rollup.
 * No dev-bypass path; callers must enforce production-safe defaults.
 */
export function evaluateIssuingAuthorization(
  input: AuthorizationEvaluationInput,
): AuthorizationEvaluationResult {
  const notes: string[] = [
    `Evaluating ${input.webhook.eventType} for authorization ${input.webhook.authorizationId}`,
  ];

  if (!input.agentId) {
    notes.push("No agent_id on card metadata — cannot resolve oracle");
    return {
      approved: false,
      declineReason: "Unknown agent for card",
      riskTierChecked: false,
      policyChecked: false,
      notes,
    };
  }

  const riskTierChecked = true;
  notes.push(`Agent ${input.agentId} risk tier ${input.risk.riskTier ?? "unknown"}`);

  if (!input.risk.found) {
    notes.push("Passport not found for agent");
    return {
      approved: false,
      declineReason: "Agent not verified",
      riskTierChecked,
      policyChecked: false,
      notes,
    };
  }

  if (!input.risk.eligible) {
    notes.push(...input.risk.reasons);
    return {
      approved: false,
      declineReason: "Agent ineligible for card spend",
      riskTierChecked,
      policyChecked: false,
      notes,
    };
  }

  const dailyLimitCents = input.risk.maxDailyLimitUsd * 100;
  const projectedSpend = input.todaySpendCents + input.webhook.amountCents;

  notes.push(
    `Daily limit $${input.risk.maxDailyLimitUsd} (${dailyLimitCents} cents); ` +
      `spent today ${input.todaySpendCents} cents; request ${input.webhook.amountCents} cents`,
  );

  const policyChecked = true;
  if (projectedSpend > dailyLimitCents) {
    return {
      approved: false,
      declineReason: "Exceeds tier daily spend limit",
      riskTierChecked,
      policyChecked,
      notes,
    };
  }

  if (input.webhook.amountCents <= 0) {
    return {
      approved: false,
      declineReason: "Invalid authorization amount",
      riskTierChecked,
      policyChecked,
      notes,
    };
  }

  notes.push("Approved within tier daily limit");
  return {
    approved: true,
    riskTierChecked,
    policyChecked,
    notes,
  };
}
