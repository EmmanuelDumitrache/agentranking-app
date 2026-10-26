import assert from "node:assert/strict";
import test from "node:test";
import { getAgentChatClientSessionId } from "../chat-session-identity";

test("draft promotion keeps the AI SDK chat identity stable", () => {
  const draft = getAgentChatClientSessionId({
    agentDbId: 32,
    conversationId: null,
    promotedConversationId: null,
    draftSessionKey: 7,
  });
  const promoted = getAgentChatClientSessionId({
    agentDbId: 32,
    conversationId: "thread-1",
    promotedConversationId: "thread-1",
    draftSessionKey: 7,
  });

  assert.equal(promoted, draft);
});

test("persisted conversation navigation uses distinct identities", () => {
  const first = getAgentChatClientSessionId({
    agentDbId: 32,
    conversationId: "thread-1",
    promotedConversationId: null,
    draftSessionKey: 7,
  });
  const second = getAgentChatClientSessionId({
    agentDbId: 32,
    conversationId: "thread-2",
    promotedConversationId: null,
    draftSessionKey: 7,
  });

  assert.notEqual(first, second);
});

test("starting another draft allocates a new client identity", () => {
  const first = getAgentChatClientSessionId({
    agentDbId: 32,
    conversationId: null,
    promotedConversationId: null,
    draftSessionKey: 7,
  });
  const second = getAgentChatClientSessionId({
    agentDbId: 32,
    conversationId: null,
    promotedConversationId: null,
    draftSessionKey: 8,
  });

  assert.notEqual(first, second);
});
