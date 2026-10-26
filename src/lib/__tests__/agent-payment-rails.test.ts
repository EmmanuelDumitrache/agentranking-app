import assert from "node:assert/strict";
import test from "node:test";
import { declaresMppSupport, resolveAgentPaymentRails } from "../agent-payment-rails";

test("detects MPP from registration JSON and SAP protocol tags", () => {
  assert.equal(declaresMppSupport({ mppSupport: true }), true);
  assert.equal(declaresMppSupport({ protocols: ["a2a", "mpp"] }), true);
  assert.equal(declaresMppSupport({ protocols: ["x402"] }), false);
});

test("materializes x402 and MPP independently", () => {
  assert.deepEqual(
    resolveAgentPaymentRails({
      declaredX402Support: true,
      declaredMppSupport: false,
      sapProtocols: ["mpp"],
    }),
    { x402Support: true, mppSupport: true },
  );

  assert.deepEqual(
    resolveAgentPaymentRails({
      x402Support: true,
      declaredMppSupport: null,
    }),
    { x402Support: true, mppSupport: false },
  );
});
