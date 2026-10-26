import { Prisma, type AgentChatSettingsRevision } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type { AgentChatScope } from "../../shared/contracts";
export const DEFAULT_AGENT_CHAT_SETTINGS = {
  enabled: true,
  persona: null,
  systemInstructions: null,
  greeting: null,
} as const;
export type AgentChatSettingsValue = {
  revisionId: string | null;
  revision: number;
  enabled: boolean;
  persona: string | null;
  systemInstructions: string | null;
  greeting: string | null;
};
type SettingsPatch = Partial<
  Pick<
    AgentChatSettingsValue,
    "enabled" | "persona" | "systemInstructions" | "greeting"
  >
>;
function toValue(
  row: AgentChatSettingsRevision | null,
): AgentChatSettingsValue {
  if (!row)
    return { revisionId: null, revision: 0, ...DEFAULT_AGENT_CHAT_SETTINGS };
  return {
    revisionId: row.id,
    revision: row.revision,
    enabled: row.enabled,
    persona: row.persona,
    systemInstructions: row.systemInstructions,
    greeting: row.greeting,
  };
}
export async function ensureCurrentSettingsRevision(
  tx: Prisma.TransactionClient,
  scope: Pick<AgentChatScope, "agentDbId" | "userProfileId">,
): Promise<AgentChatSettingsRevision> {
  await tx.agentChatSettings.upsert({
    where: { agentDbId: scope.agentDbId },
    create: { agentDbId: scope.agentDbId },
    update: {},
  });
  await tx.$queryRaw`SELECT id FROM agent_chat_settings WHERE agent_db_id = ${scope.agentDbId} FOR UPDATE`;
  const settings = await tx.agentChatSettings.findUniqueOrThrow({
    where: { agentDbId: scope.agentDbId },
    include: { currentRevision: true },
  });
  if (settings.currentRevision) return settings.currentRevision;
  const revision = await tx.agentChatSettingsRevision.create({
    data: {
      settingsId: settings.id,
      agentDbId: scope.agentDbId,
      revision: 1,
      ...DEFAULT_AGENT_CHAT_SETTINGS,
      createdByUserProfileId: scope.userProfileId,
    },
  });
  await tx.agentChatSettings.update({
    where: { id: settings.id },
    data: { currentRevisionId: revision.id },
  });
  return revision;
}
export async function createAgentChatSettingsRevision(
  scope: AgentChatScope,
  patch: SettingsPatch,
): Promise<AgentChatSettingsValue> {
  return prisma.$transaction(
    async (tx) => {
      const current = await ensureCurrentSettingsRevision(tx, scope);
      const next = {
        enabled: patch.enabled ?? current.enabled,
        persona: patch.persona === undefined ? current.persona : patch.persona,
        systemInstructions:
          patch.systemInstructions === undefined
            ? current.systemInstructions
            : patch.systemInstructions,
        greeting:
          patch.greeting === undefined ? current.greeting : patch.greeting,
      };
      if (
        next.enabled === current.enabled &&
        next.persona === current.persona &&
        next.systemInstructions === current.systemInstructions &&
        next.greeting === current.greeting
      ) {
        return toValue(current);
      }
      const revision = await tx.agentChatSettingsRevision.create({
        data: {
          settingsId: current.settingsId,
          agentDbId: scope.agentDbId,
          revision: current.revision + 1,
          ...next,
          createdByUserProfileId: scope.userProfileId,
        },
      });
      await tx.agentChatSettings.update({
        where: { id: current.settingsId },
        data: { currentRevisionId: revision.id },
      });
      return toValue(revision);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}