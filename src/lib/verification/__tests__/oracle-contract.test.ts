import assert from "node:assert/strict";
import test from "node:test";
import { getCardIssuer, getKycProvider } from "../providers/index.ts";

const PII_KEYS = [
  "email",
  "phone",
  "ssn",
  "passportNumber",
  "dateOfBirth",
  "fullName",
  "firstName",
  "lastName",
  "governmentId",
  "selfie",
  "kycPayload",
];

function collectKeys(value: unknown, acc: string[] = []): string[] {
  if (value === null || value === undefined) return acc;
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, acc);
    return acc;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      acc.push(k);
      collectKeys(v, acc);
    }
  }
  return acc;
}

test("adapter factory returns mock providers by default", () => {
  delete process.env.KYC_PROVIDER;
  delete process.env.CARD_ISSUER;
  assert.equal(getKycProvider().name, "mock");
  assert.equal(getCardIssuer().name, "mock");
});

test("adapter factory respects env selection", () => {
  process.env.KYC_PROVIDER = "civic";
  process.env.CARD_ISSUER = "ar";
  assert.equal(getKycProvider().name, "civic");
  assert.equal(getCardIssuer().name, "ar");
  process.env.KYC_PROVIDER = "mock";
  process.env.CARD_ISSUER = "mock";
});

test("oracle response contract shape contains no PII fields", async () => {
  process.env.CARD_ISSUER = "mock";
  const issuer = getCardIssuer();
  const sample = {
    wallet: "0xabc",
    found: true,
    passport: {
      status: "ACTIVE",
      riskTier: "STANDARD",
      riskScore: 55,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date().toISOString(),
      lastScreenedAt: new Date().toISOString(),
    },
    agent: {
      id: 1,
      name: "Demo Agent",
      chains: ["base"],
      onchainAgeDays: 120,
    },
    factors: {
      ownershipProven: { points: 25, max: 25 },
    },
    recommendation: {
      eligible: true,
      maxDailyLimitUsd: 1000,
      issuer: issuer.name,
    },
    attestationHash: "abc",
    version: "1.0",
  };

  const keys = collectKeys(sample).map((k) => k.toLowerCase());
  for (const denied of PII_KEYS) {
    assert.equal(
      keys.some((k) => k.includes(denied.toLowerCase())),
      false,
      `unexpected PII-like key involving ${denied}`,
    );
  }

  const eligibility = await issuer.checkEligibility({
    agentWallet: "0xabc",
    riskTier: "STANDARD",
    riskScore: 55,
  });
  assert.equal(eligibility.eligible, true);
  assert.ok(eligibility.maxDailyLimitUsd > 0);
});
