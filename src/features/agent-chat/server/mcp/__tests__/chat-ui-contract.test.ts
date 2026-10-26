import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

async function source(relative: string): Promise<string> {
  return await readFile(path.join(process.cwd(), relative), "utf8");
}

test("MCP failures stream as inline notices without replacing chat history", async () => {
  const stream = await source("src/features/agent-chat/server/run/stream-run.ts");
  const conversation = await source("src/features/agent-chat/client/AgentChatConversation.tsx");
  const controller = await source("src/features/agent-chat/client/chat-controller.ts");
  assert.match(stream, /toolRuntime\?\.mcpWarnings/);
  assert.match(stream, /type: "data-notice"/);
  assert.match(stream, /level: "warning"/);
  assert.match(conversation, /case "data-notice"/);
  assert.match(conversation, /function NoticePart/);
  assert.match(conversation, /role=\{level === "error" \? "alert" : "status"\}/);
  assert.match(controller, /Do[\s\S]*?not let an asynchronous query overwrite potentially live local state/);
  assert.doesNotMatch(controller, /window\.location|router\.(?:push|replace)/);
});

test("agent switches are accessible, single-flight in the UI, optimistic, and rollback on error", async () => {
  const page = await source("src/components/dashboard/agent-mcp-connections-page.tsx");
  assert.match(page, /role="switch"/);
  assert.match(page, /aria-checked=\{enabled\}/);
  assert.match(page, /disabled=\{busyId !== null/);
  assert.match(page, /const snapshot = item/);
  assert.match(page, /optimisticBinding\(candidate, enabled\)/);
  assert.match(page, /candidate\.connection\.id === snapshot\.connection\.id \? snapshot : candidate/);
  assert.match(page, /enableBlockedReason/);
  assert.match(page, /enabledToolCount/);
  assert.match(page, /highestEnabledRisk/);
  assert.match(page, /platformBlocked/);
  assert.match(page, /Assigned but currently unavailable/);
  assert.match(page, /\/dashboard\/connections\?focus=/);
  assert.match(page, /runConnectionAction/);
  assert.match(page, /reconnectOAuth/);
  assert.match(page, /refreshReferencingBindings/);
  assert.match(page, /Refresh catalog/);
});

test("connection wizard uses generated auth choices and clears secret state after submission", async () => {
  const page = await source("src/components/dashboard/mcp-connections-page.tsx");
  const cards = await source("src/components/dashboard/mcp-reviewed-providers.tsx");
  assert.match(page, /selectedProvider\.authOptions/);
  assert.match(page, /credentialPayload/);
  assert.match(page, /type="password" autoComplete="off"/);
  assert.ok((page.match(/setSecret\(""\)/g)?.length ?? 0) >= 4);
  assert.ok((page.match(/setClientSecret\(""\)/g)?.length ?? 0) >= 4);
  assert.match(page, /exact OAuth token endpoint and issuer/);
  assert.match(page, /Replace API key/);
  assert.match(page, /invalidateVisibleAgentBindings/);
  assert.match(page, /wizardProviderGroups/);
  assert.match(page, /Affected agents/);
  assert.match(page, /Detach all listed agents and delete this connection/);
  assert.match(page, /disabled=\{manageConnection\.providerManifestMissing\}/);
  assert.match(page, /Remote and credential settings are locked/);
  assert.match(page, /api-key-query/);
  assert.match(page, /api-key-tool-argument/);
  assert.match(page, /disabled=\{!provider\.connectable\}/);
  assert.match(cards, /Search \$\{providers\.length\} providers/);
  assert.match(cards, /All capabilities/);
  assert.match(cards, /All risk levels/);
  assert.match(cards, /All release stages/);
  assert.match(cards, /provider\.capabilityClasses/);
  assert.match(cards, /provider\.unavailableReason/);
  assert.match(cards, /provider\.brand/);
});

test("tool configuration surfaces grouping, schema changes, quarantine review, and focusable labels", async () => {
  const page = await source("src/components/dashboard/agent-mcp-connections-page.tsx");
  assert.match(page, /groupedTools/);
  assert.match(page, /Schema changed/);
  assert.match(page, /Review changed tool schema/);
  assert.match(page, /acknowledgeSchemaHash/);
  assert.match(page, /aria-label=\{`Approval policy for \$\{tool\.name\}`\}/);
  assert.match(page, /aria-label=\{`\$\{tool\.enabled \? "Disable" : "Enable"\} \$\{tool\.name\}`\}/);
});

test("chat tool cards show trusted MCP provenance, effective risk, and native handoff status", async () => {
  const card = await source("src/features/agent-chat/client/AgentChatToolCard.tsx");
  assert.match(card, /function getMcpProvenance/);
  assert.match(card, /trusted\?\.externalToolName/);
  assert.match(card, /trusted\?\.effectiveRisk/);
  assert.match(card, /trusted\?\.connectionId/);
  assert.match(card, /Native review/);
  assert.match(card, /Transaction blocked/);
  assert.match(card, /May prepare an unsigned transaction; it cannot sign or broadcast it/);
  assert.match(card, /sanitizeMcpDisplayValue/);
  assert.match(card, /Sanitized parameters/);
  assert.match(card, /\[REDACTED\]/);
  assert.match(card, /recipient/);
  assert.match(card, /minimum output/);
  assert.match(card, /slippage/);
});

test("elicitation UI accepts only bounded non-secret forms and public HTTPS links", async () => {
  const continuations = await source("src/features/agent-chat/server/mcp/continuations.ts");
  const card = await source("src/features/agent-chat/client/McpElicitationCard.tsx");
  assert.match(continuations, /validateMcpJsonSchema/);
  assert.match(continuations, /schemaRequestsCredential/);
  assert.match(continuations, /validatePublicMcpOAuthUrl/);
  assert.match(continuations, /safeElicitationMessage/);
  assert.match(card, /url\.protocol === "https:"/);
  assert.match(card, /!url\.username && !url\.password && !url\.hash/);
});

test("MCP dashboard context never aliases partial numeric agent IDs", async () => {
  const accountPage = await source("src/app/dashboard/(workspace)/connections/page.tsx");
  const agentPage = await source("src/app/dashboard/(workspace)/agents/[agentDbId]/connections/page.tsx");
  assert.match(accountPage, /\^\[1-9\]\\d\*\$/);
  assert.doesNotMatch(accountPage, /Number\.parseInt/);
  assert.match(agentPage, /parsePositiveAgentId/);
  assert.doesNotMatch(agentPage, /Number\.parseInt/);
});
