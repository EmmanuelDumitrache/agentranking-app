import assert from "node:assert/strict";
import test from "node:test";
import { assertSameOriginMutation } from "../http-same-origin";

function requestWithHeaders(url: string, headers: Record<string, string>): Request {
  return new Request(url, { method: "PUT", headers });
}

function captureWarnings(run: () => void): unknown[][] {
  const previous = console.warn;
  const warnings: unknown[][] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
  try {
    run();
  } finally {
    console.warn = previous;
  }
  return warnings;
}

function assertForbidden(run: () => void): void {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal((error as Error & { status?: number }).status, 403);
    assert.equal(error.message, "Cross-origin mutation is not permitted");
    return true;
  });
}

test("allows a matching request URL origin", () => {
  assert.doesNotThrow(() => {
    assertSameOriginMutation(requestWithHeaders("https://app.agentranking.io/api/test", {
      origin: "https://app.agentranking.io",
    }));
  });
});

test("allows a public HTTPS origin when Next.js sees an internal upstream URL", () => {
  assert.doesNotThrow(() => {
    assertSameOriginMutation(requestWithHeaders("http://127.0.0.1:3000/api/test", {
      host: "app.agentranking.io",
      origin: "https://app.agentranking.io",
      "x-forwarded-proto": "https",
    }));
  });
});

test("prefers an explicitly forwarded public host and protocol", () => {
  assert.doesNotThrow(() => {
    assertSameOriginMutation(requestWithHeaders("http://127.0.0.1:3000/api/test", {
      host: "127.0.0.1:3000",
      origin: "https://app.agentranking.io",
      "x-forwarded-host": "app.agentranking.io",
      "x-forwarded-proto": "https",
    }));
  });
});

test("uses the first value from proxy header chains", () => {
  assert.doesNotThrow(() => {
    assertSameOriginMutation(requestWithHeaders("http://127.0.0.1:3000/api/test", {
      origin: "https://app.agentranking.io",
      "x-forwarded-host": "app.agentranking.io, internal.example",
      "x-forwarded-proto": "https, http",
    }));
  });
});

test("rejects a real cross-origin mutation and logs only origin diagnostics", () => {
  const warnings = captureWarnings(() => {
    assertForbidden(() => {
      assertSameOriginMutation(requestWithHeaders("http://127.0.0.1:3000/api/test", {
        origin: "https://agentranking.io",
        "x-forwarded-host": "app.agentranking.io",
        "x-forwarded-proto": "https",
      }));
    });
  });

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.[0], "[http-same-origin] rejected mutation");
  assert.deepEqual(warnings[0]?.[1], {
    origin: "https://agentranking.io",
    expectedOrigin: "https://app.agentranking.io",
    hostSource: "x-forwarded-host",
    protocolSource: "x-forwarded-proto",
    reason: "origin-mismatch",
  });
});

test("rejects opaque or malformed origins without echoing raw header data", () => {
  for (const origin of ["null", "not-an-origin", "https://app.agentranking.io/not-an-origin"]) {
    const warnings = captureWarnings(() => {
      assertForbidden(() => {
        assertSameOriginMutation(requestWithHeaders("https://app.agentranking.io/api/test", {
          origin,
        }));
      });
    });
    assert.equal(warnings.length, 1);
    assert.deepEqual(warnings[0]?.[1], {
      origin: "<invalid>",
      expectedOrigin: "https://app.agentranking.io",
      hostSource: "request-url",
      protocolSource: "request-url",
      reason: "invalid-origin",
    });
  }
});

test("never includes credential request contents in rejection diagnostics", () => {
  const secret = "AIza-test-secret-that-must-not-be-logged";
  const request = new Request(
    "http://127.0.0.1:3000/api/dashboard/settings/llm-provider-credentials",
    {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        origin: "https://agentranking.io",
        "x-forwarded-host": "app.agentranking.io",
        "x-forwarded-proto": "https",
      },
      body: JSON.stringify({ provider: "google-ai-studio", secret }),
    },
  );

  const warnings = captureWarnings(() => {
    assertForbidden(() => assertSameOriginMutation(request));
  });

  assert.equal(JSON.stringify(warnings).includes(secret), false);
  assert.equal(JSON.stringify(warnings).includes("llm-provider-credentials"), false);
});

test("rejects malformed forwarded authority values", () => {
  const warnings = captureWarnings(() => {
    assertForbidden(() => {
      assertSameOriginMutation(requestWithHeaders("http://127.0.0.1:3000/api/test", {
        origin: "https://app.agentranking.io",
        "x-forwarded-host": "app.agentranking.io/invalid",
        "x-forwarded-proto": "https",
      }));
    });
  });

  assert.deepEqual(warnings[0]?.[1], {
    origin: "https://app.agentranking.io",
    expectedOrigin: "<invalid>",
    hostSource: "x-forwarded-host",
    protocolSource: "x-forwarded-proto",
    reason: "invalid-expected-origin",
  });
});

test("preserves the existing no-Origin behavior for non-browser callers", () => {
  assert.doesNotThrow(() => {
    assertSameOriginMutation(requestWithHeaders("http://127.0.0.1:3000/api/test", {}));
  });
});
