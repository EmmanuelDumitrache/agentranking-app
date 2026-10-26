import assert from "node:assert/strict";
import test from "node:test";

/**
 * Pure policy helpers mirrored from spending-policy-service rules for unit coverage
 * without a live database.
 */
function evaluateCategoryRules(params: {
  category: string;
  allowed: string[];
  blocked: string[];
}): string[] {
  const reasons: string[] = [];
  const category = params.category.trim().toLowerCase();
  if (category && params.blocked.map((c) => c.toLowerCase()).includes(category)) {
    reasons.push(`Category "${category}" is blocked`);
  }
  if (
    category &&
    params.allowed.length > 0 &&
    !params.allowed.map((c) => c.toLowerCase()).includes(category)
  ) {
    reasons.push(`Category "${category}" is not in the allowlist`);
  }
  return reasons;
}

function evaluateLimits(params: {
  amount: number;
  dailyUsed: number;
  dailyLimit: number;
  weeklyUsed: number;
  weeklyLimit: number;
  monthlyUsed: number;
  monthlyLimit: number;
}): string[] {
  const reasons: string[] = [];
  if (params.dailyUsed + params.amount > params.dailyLimit) {
    reasons.push("Would exceed daily spending limit");
  }
  if (params.weeklyUsed + params.amount > params.weeklyLimit) {
    reasons.push("Would exceed weekly spending limit");
  }
  if (params.monthlyUsed + params.amount > params.monthlyLimit) {
    reasons.push("Would exceed monthly spending limit");
  }
  return reasons;
}

test("blocked category rejects", () => {
  const reasons = evaluateCategoryRules({
    category: "gambling",
    allowed: [],
    blocked: ["gambling"],
  });
  assert.ok(reasons.some((r) => r.includes("blocked")));
});

test("allowlist rejects unknown category", () => {
  const reasons = evaluateCategoryRules({
    category: "hotels",
    allowed: ["api_credits", "saas"],
    blocked: [],
  });
  assert.ok(reasons.some((r) => r.includes("allowlist")));
});

test("daily limit boundary", () => {
  const ok = evaluateLimits({
    amount: 100,
    dailyUsed: 9900,
    dailyLimit: 10000,
    weeklyUsed: 0,
    weeklyLimit: 50000,
    monthlyUsed: 0,
    monthlyLimit: 200000,
  });
  assert.equal(ok.length, 0);

  const fail = evaluateLimits({
    amount: 101,
    dailyUsed: 9900,
    dailyLimit: 10000,
    weeklyUsed: 0,
    weeklyLimit: 50000,
    monthlyUsed: 0,
    monthlyLimit: 200000,
  });
  assert.ok(fail.some((r) => r.includes("daily")));
});
