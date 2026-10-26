-- Persist AI SDK UIMessage roles directly. This is a storage-schema change only;
-- there is no runtime compatibility path for the previous enum representation.
ALTER TYPE "AgentChatMessageRole" RENAME TO "AgentChatMessageRole_legacy";
CREATE TYPE "AgentChatMessageRole" AS ENUM ('user', 'assistant', 'system');

ALTER TABLE "agent_chat_messages"
  ALTER COLUMN "role" TYPE "AgentChatMessageRole"
  USING lower("role"::text)::"AgentChatMessageRole";

DROP TYPE "AgentChatMessageRole_legacy";
