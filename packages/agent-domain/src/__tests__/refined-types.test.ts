import assert from "node:assert/strict";
import test from "node:test";
import {
  createAgentDbId,
  tryCreateAgentDbId,
  createPositiveSafeInt,
  createNonNegativeSafeInt,
  createDurationMs,
  createBasisPoints,
  createValidDate,
  INT32_MAX,
} from "../refined-types.js";

test("createAgentDbId validates positive 32-bit safe integers", () => {
  assert.equal(createAgentDbId(1), 1);
  assert.equal(createAgentDbId(INT32_MAX), INT32_MAX);
  assert.throws(() => createAgentDbId(0), TypeError);
  assert.throws(() => createAgentDbId(-1), TypeError);
  assert.throws(() => createAgentDbId(INT32_MAX + 1), TypeError);
  assert.throws(() => createAgentDbId(NaN), TypeError);
  assert.throws(() => createAgentDbId(Infinity), TypeError);
  assert.throws(() => createAgentDbId(1.5), TypeError);
});

test("tryCreateAgentDbId returns null for invalid inputs", () => {
  assert.equal(tryCreateAgentDbId(42), 42);
  assert.equal(tryCreateAgentDbId("42"), null);
  assert.equal(tryCreateAgentDbId(0), null);
  assert.equal(tryCreateAgentDbId(-5), null);
  assert.equal(tryCreateAgentDbId(null), null);
});

test("numeric refinements enforce domain constraints", () => {
  assert.equal(createPositiveSafeInt(10), 10);
  assert.throws(() => createPositiveSafeInt(0), TypeError);

  assert.equal(createNonNegativeSafeInt(0), 0);
  assert.throws(() => createNonNegativeSafeInt(-1), TypeError);

  assert.equal(createDurationMs(5000), 5000);
  assert.throws(() => createDurationMs(-10), TypeError);

  assert.equal(createBasisPoints(500), 500);
  assert.throws(() => createBasisPoints(10001), TypeError);
  assert.throws(() => createBasisPoints(-1), TypeError);
});

test("createValidDate validates timestamp existence", () => {
  const valid = new Date();
  assert.equal(createValidDate(valid).getTime(), valid.getTime());
  assert.throws(() => createValidDate("not-a-date"), TypeError);
});
