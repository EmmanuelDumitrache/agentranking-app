import { z } from "zod";

export const agentScheduleExecutePayloadSchema = z.object({
  v: z.literal(1),
  scheduleId: z.string().min(1),
  scheduledFor: z.string().datetime(),
});

export type AgentScheduleExecutePayload = z.infer<
  typeof agentScheduleExecutePayloadSchema
>;
