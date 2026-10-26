import assert from "node:assert/strict";
import test from "node:test";
import {
  computeRiskScore,
  scoreCounterpartyDiversity,
  scoreOnchainAgeDays,
  scorePlatformReputation,
  scoreTransactionHistory,
  tierFromScore,
} from "../risk-engine.ts";
import {
  MockSanctionsScreener,
  setSanctionsScreenerForTests,
} from "../screening.ts";

test("onchain age factor boundaries", () => {
  assert.equal(scoreOnchainAgeDays(0), 0);
  assert.equal(scoreOnchainAgeDays(29), 0);
  assert.equal(scoreOnchainAgeDays(30), 5);
  assert.equal(scoreOnchainAgeDays(90), 10);
  assert.equal(scoreOnchainAgeDays(365), 15);
  assert.equal(scoreOnchainAgeDays(400), 15);
});

test("transaction history log scale is capped at 15", () => {
  assert.equal(scoreTransactionHistory(0, 0), 0);
  assert.ok(scoreTransactionHistory(10, 100) > 0);
  assert.ok(scoreTransactionHistory(1_000_000, 1_000_000_000) <= 15);
});

test("counterparty diversity steps", () => {
  assert.equal(scoreCounterpartyDiversity(0), 0);
  assert.equal(scoreCounterpartyDiversity(5), 4);
  assert.equal(scoreCounterpartyDiversity(50), 10);
});

test("platform reputation scales 0–5", () => {
  assert.equal(scorePlatformReputation(0), 0);
  assert.equal(scorePlatformReputation(100), 5);
  assert.equal(scorePlatformReputation(50), 3);
});

test("tier boundaries", () => {
  assert.equal(tierFromScore(0), "UNRATED");
  assert.equal(tierFromScore(19), "UNRATED");
  assert.equal(tierFromScore(20), "BASIC");
  assert.equal(tierFromScore(39), "BASIC");
  assert.equal(tierFromScore(40), "STANDARD");
  assert.equal(tierFromScore(59), "STANDARD");
  assert.equal(tierFromScore(60), "ELEVATED");
  assert.equal(tierFromScore(79), "ELEVATED");
  assert.equal(tierFromScore(80), "PRIVILEGED");
  assert.equal(tierFromScore(100), "PRIVILEGED");
});

test("full score with ownership and clean sanctions", async () => {
  setSanctionsScreenerForTests(new MockSanctionsScreener());
  const result = await computeRiskScore({
    ownershipProven: true,
    onchainAgeDays: 400,
    txCount: 1000,
    volumeUsd: 50_000,
    uniqueCounterparties: 50,
    endpointAlive: true,
    capabilityConsistent: true,
    walletAddresses: ["0xabc"],
    platformReputationScore: 100,
  });
  assert.equal(result.hardFail, false);
  assert.equal(result.factors.ownershipProven.points, 25);
  assert.equal(result.factors.sanctionsScreening.points, 10);
  assert.ok(result.score >= 80);
  assert.equal(result.tier, "PRIVILEGED");
  assert.equal(result.assessorVersion, "1.0.0");
});

test("sanctions hard fail zeros score and flags suspension path", async () => {
  setSanctionsScreenerForTests(new MockSanctionsScreener());
  const result = await computeRiskScore({
    ownershipProven: true,
    onchainAgeDays: 400,
    txCount: 1000,
    volumeUsd: 50_000,
    uniqueCounterparties: 50,
    endpointAlive: true,
    capabilityConsistent: true,
    walletAddresses: ["0x000000000000000000000000000000000000dead"],
    platformReputationScore: 100,
  });
  assert.equal(result.hardFail, true);
  assert.equal(result.score, 0);
  assert.equal(result.tier, "UNRATED");
  assert.equal(result.factors.sanctionsScreening.hardFail, true);
});
