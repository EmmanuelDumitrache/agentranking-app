import assert from "node:assert/strict";
import test from "node:test";
import { classifyProviderFailure } from "../../provider-failure";

test("classifies truncated OpenAI-compatible streams as retryable transport failures", () => {
  const failure = classifyProviderFailure({
    error: new Error("Response stream ended without a finish reason."),
    provider: "opencode",
    source: "inference",
    model: {
      modelKey: "opencode:test-model",
      providerModelId: "test-model",
    },
  });

  assert.equal(failure.kind, "transport");
  assert.equal(failure.retryable, true);
  assert.equal(failure.failoverEligible, true);
  assert.equal(failure.credentialDisposition, "keep");
  assert.equal(failure.publicError.code, "PROVIDER_UNAVAILABLE");
  assert.equal(failure.modelKey, "opencode:test-model");
});
