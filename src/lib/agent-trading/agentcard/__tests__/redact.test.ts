import assert from "node:assert/strict";
import test from "node:test";
import { redactAgentCardPayload } from "../redact";

test("redactAgentCardPayload redacts pan/cvv while keeping metadata", () => {
  const input = {
    status: "ok",
    sensitive: true,
    id: "req_123",
    card: {
      pan: "4111111111111111",
      cvv: "123",
      expiryMonth: 12,
      expiryYear: 2028,
      last4: "1111",
    },
  };
  const out = redactAgentCardPayload(input) as typeof input;
  assert.equal(out.card.pan, "[REDACTED]");
  assert.equal(out.card.cvv, "[REDACTED]");
  assert.equal(out.card.expiryMonth, "[REDACTED]");
  assert.equal(out.id, "req_123");
  assert.equal(out.card.last4, "1111");
});

test("redactAgentCardPayload redacts top-level credential fields", () => {
  const out = redactAgentCardPayload({
    pan: "4111111111111111",
    cvv: "999",
    codes: [{ code: "123456", match: "confirmed" }],
  }) as Record<string, unknown>;
  assert.equal(out.pan, "[REDACTED]");
  assert.equal(out.cvv, "[REDACTED]");
  assert.equal((out.codes as Array<{ code: string }>)[0].code, "123456");
});
