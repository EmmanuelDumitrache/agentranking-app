import assert from "node:assert/strict";
import test from "node:test";
import { getCardIssuer, getKycProvider } from "../providers/index.ts";

test("verification kyc factory defaults to mock", () => {
  delete process.env.KYC_PROVIDER;
  assert.equal(getKycProvider().name, "mock");
});

test("verification kyc factory supports persona", () => {
  process.env.KYC_PROVIDER = "persona";
  assert.equal(getKycProvider().name, "persona");
  process.env.KYC_PROVIDER = "mock";
});

test("verification card issuer factory defaults to mock", () => {
  delete process.env.CARD_ISSUER;
  delete process.env.CARD_ISSUER_PROVIDER;
  assert.equal(getCardIssuer().name, "mock");
});

test("verification card issuer maps ar aliases", () => {
  process.env.CARD_ISSUER = "kripicard";
  assert.equal(getCardIssuer().name, "ar");
  process.env.CARD_ISSUER = "mock";
});

test("ar issuer eligibility blocks unrated agents", async () => {
  process.env.CARD_ISSUER = "ar";
  const issuer = getCardIssuer();
  const result = await issuer.checkEligibility({
    agentWallet: "wallet123",
    riskTier: "UNRATED",
    riskScore: 80,
  });
  assert.equal(result.eligible, false);
  process.env.CARD_ISSUER = "mock";
});
