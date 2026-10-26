CREATE INDEX "agent_chat_artifacts_conversation_id_tool_call_id_idx"
ON "agent_chat_artifacts"("conversation_id", "tool_call_id");
