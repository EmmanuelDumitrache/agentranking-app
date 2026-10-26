import assert from "node:assert/strict";
import test from "node:test";
import {
  checkArDailyCap,
  recordArDailySpend,
  validateAgentCardAmountDollars,
} from "../policy";

const originalEnv = { ...process.env };

test.afterEach(() => {
  process.env = { ...originalEnv };
});

test("validateAgentCardAmountDollars rejects non-positive amounts", () => {
  assert.equal(validateAgentCardAmountDollars(0).ok, false);
  assert.equal(validateAgentCardAmountDollars(-5).ok, false);
});

test("validateAgentCardAmountDollars ceil-rounds and caps", () => {
  process.env.AGENTCARD_MAX_CARD_AMOUNT_DOLLARS = "150";
  const result = validateAgentCardAmountDollars(49.2);
  assert.equal(result.ok, true);
  assert.equal(result.roundedDollars, 50);
  assert.equal(result.amountCents, 5000);
});

test("validateAgentCardAmountDollars rejects amounts above per-card cap", () => {
  process.env.AGENTCARD_MAX_CARD_AMOUNT_DOLLARS = "150";
  assert.equal(validateAgentCardAmountDollars(151).ok, false);
});

test("checkArDailyCap allows spend when no AR cap is configured", () => {
  delete process.env.AGENTCARD_AR_DAILY_CAP_USD;
  assert.equal(checkArDailyCap(1, 10_000).ok, true);
});

test("checkArDailyCap enforces optional AR daily cap per agent", () => {
  process.env.AGENTCARD_AR_DAILY_CAP_USD = "100";
  assert.equal(checkArDailyCap(42, 60_00).ok, true);
  recordArDailySpend(42, 60_00);
  assert.equal(checkArDailyCap(42, 50_00).ok, false);
  assert.equal(checkArDailyCap(99, 50_00).ok, true);
});
