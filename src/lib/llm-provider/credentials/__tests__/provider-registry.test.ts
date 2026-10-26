import assert from "node:assert/strict";
import test from "node:test";
import {
  getProviderCredentialAdapter,
  listProviderCredentialDescriptors,
} from "../provider-registry";

function withMockFetch(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>,
): () => void {
  const previous = globalThis.fetch;
  globalThis.fetch = handler as typeof fetch;
  return () => {
    globalThis.fetch = previous;
  };
}

test("BYOK provider registry exposes all first-class providers", () => {
  assert.deepEqual(
    listProviderCredentialDescriptors().map((provider) => provider.id),
    ["google-ai-studio", "openai", "anthropic", "deepseek"],
  );
});

test("OpenAI BYOK discovers only agent-compatible Responses models", async () => {
  const adapter = getProviderCredentialAdapter("openai");
  assert.ok(adapter);
  const restore = withMockFetch((input, init) => {
    assert.equal(String(input), "https://api.openai.com/v1/models");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer sk-openai-test");
    return new Response(JSON.stringify({
      object: "list",
      data: [
        { id: "gpt-5.4", object: "model", owned_by: "openai" },
        { id: "text-embedding-3-large", object: "model", owned_by: "openai" },
        { id: "gpt-realtime", object: "model", owned_by: "openai" },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  try {
    const models = await adapter.listModels("sk-openai-test");
    assert.deepEqual(models.map((model) => model.providerModelId), ["gpt-5.4"]);
    assert.equal(models[0]?.adapter, "openai-responses");
    assert.equal(models[0]?.capabilities.tools, true);
    assert.equal(models[0]?.capabilities.reasoning, true);
  } finally {
    restore();
  }
});

test("Anthropic BYOK uses the Models API capability metadata", async () => {
  const adapter = getProviderCredentialAdapter("anthropic");
  assert.ok(adapter);
  const restore = withMockFetch((input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin + url.pathname, "https://api.anthropic.com/v1/models");
    assert.equal(url.searchParams.get("limit"), "1000");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("x-api-key"), "sk-ant-test");
    assert.equal(headers.get("anthropic-version"), "2023-06-01");
    return new Response(JSON.stringify({
      data: [{
        id: "claude-opus-4-6",
        display_name: "Claude Opus 4.6",
        max_input_tokens: 1_000_000,
        max_tokens: 64_000,
        capabilities: {
          image_input: { supported: true },
          pdf_input: { supported: true },
          thinking: { supported: true },
        },
      }],
      has_more: false,
      last_id: "claude-opus-4-6",
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  try {
    const models = await adapter.listModels("sk-ant-test");
    assert.equal(models.length, 1);
    assert.equal(models[0]?.adapter, "anthropic-messages");
    assert.equal(models[0]?.contextWindowTokens, 1_064_000);
    assert.equal(models[0]?.maxInputTokens, 1_000_000);
    assert.equal(models[0]?.maxOutputTokens, 8_192);
    assert.equal(models[0]?.capabilities.images, true);
    assert.equal(models[0]?.capabilities.attachments, true);
    assert.equal(models[0]?.capabilities.reasoning, true);
  } finally {
    restore();
  }
});

test("DeepSeek BYOK discovers V4 models with bearer auth", async () => {
  const adapter = getProviderCredentialAdapter("deepseek");
  assert.ok(adapter);
  const restore = withMockFetch((input, init) => {
    assert.equal(String(input), "https://api.deepseek.com/models");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer ds-test");
    return new Response(JSON.stringify({
      object: "list",
      data: [
        { id: "deepseek-v4-flash", object: "model", owned_by: "deepseek" },
        { id: "deepseek-v4-pro", object: "model", owned_by: "deepseek" },
        { id: "embedding-model", object: "model", owned_by: "deepseek" },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  try {
    const models = await adapter.listModels("ds-test");
    assert.deepEqual(
      models.map((model) => model.providerModelId).sort(),
      ["deepseek-v4-flash", "deepseek-v4-pro"],
    );
    assert.ok(models.every((model) => model.adapter === "deepseek-anthropic-messages"));
    assert.ok(models.every((model) => model.contextWindowTokens === 1_000_000));
    assert.ok(models.every((model) => model.capabilities.tools && model.capabilities.reasoning));
  } finally {
    restore();
  }
});
