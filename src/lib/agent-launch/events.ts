import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
export type AgentLaunchEventType =
  | "draft_created"
  | "draft_updated"
  | "passport_previewed"
  | "metadata_generated"
  | "passport_repaired"
  | "token_create_placeholder"
  | "fee_share_placeholder"
  | "creation_confirmed"
  | "creation_recovered"
  | "fee_share_active"
  | "test_buy_confirmed"
  | "test_sell_confirmed"
  | "distribution_attempted"
  | "distribution_skipped"
  | "distribution_failed"
  | "distribution_succeeded";
export type RecordAgentLaunchEventInput = {
  launchId: string;
  type: AgentLaunchEventType;
  txSignature?: string | null;
  payloadJson?: Record<string, unknown> | null;
};
function eventData(input: RecordAgentLaunchEventInput): Prisma.AgentLaunchEventUncheckedCreateInput {
  return {
    launchId: input.launchId,
    type: input.type,
    txSignature: input.txSignature ?? null,
    payloadJson:
      input.payloadJson != null
        ? (input.payloadJson as Prisma.InputJsonValue)
        : undefined,
  };
}
export async function recordAgentLaunchEventInTx(
  tx: Prisma.TransactionClient,
  input: RecordAgentLaunchEventInput,
) {
  return tx.agentLaunchEvent.create({ data: eventData(input) });
}
export async function recordAgentLaunchEvent(input: RecordAgentLaunchEventInput) {
  return prisma.agentLaunchEvent.create({ data: eventData(input) });
}
