import assert from "node:assert/strict";
import test from "node:test";
import type { TreasuryTransaction } from "@/generated/prisma/client";
import {
  assertNoSpendingCategoryOverlap,
  normalizeSpendingCategories,
} from "../services/spending-policy-service.ts";
import { assertTreasuryIdempotencyReplayMatches } from "../services/wallet-service.ts";

const baseTreasuryTransaction: TreasuryTransaction = {
  id: "tx-1",
  appAccountId: "account-1",
  agentId: 7,
  walletId: "wallet-1",
  cardId: "card-1",
  type: "SPEND",
  amountCents: 1_250,
  currency: "USDC",
  merchant: "merchant",
  category: "saas",
  reason: "subscription",
  status: "SETTLED",
  providerTransactionId: "provider-1",
  idempotencyKey: "idem-1",
  balanceAfterCents: 8_750,
  metadata: { reserveTransactionId: "reserve-1" },
  createdAt: new Date("2026-08-21T00:00:00.000Z"),
};

test("treasury idempotency accepts an exact replay", () => {
  assert.doesNotThrow(() =>
    assertTreasuryIdempotencyReplayMatches(baseTreasuryTransaction, {
      appAccountId: "account-1",
      type: "SPEND",
      amountCents: 1_250,
      agentId: 7,
      cardId: "card-1",
      merchant: "merchant",
      category: "saas",
      reason: "subscription",
      providerTransactionId: "provider-1",
      reserveTransactionId: "reserve-1",
    }),
  );
});

test("treasury idempotency rejects a reused key with different money semantics", () => {
  assert.throws(
    () =>
      assertTreasuryIdempotencyReplayMatches(baseTreasuryTransaction, {
        appAccountId: "account-1",
        type: "SPEND",
        amountCents: 2_500,
        agentId: 7,
      }),
    /different treasury operation/,
  );

  assert.throws(
    () =>
      assertTreasuryIdempotencyReplayMatches(baseTreasuryTransaction, {
        appAccountId: "account-1",
        type: "SPEND",
        amountCents: 1_250,
        agentId: 8,
      }),
    /different treasury operation/,
  );
});

test("treasury idempotency binds a spend to its reserve", () => {
  assert.throws(
    () =>
      assertTreasuryIdempotencyReplayMatches(baseTreasuryTransaction, {
        appAccountId: "account-1",
        type: "SPEND",
        amountCents: 1_250,
        reserveTransactionId: "reserve-2",
      }),
    /different treasury operation/,
  );
});

test("spending categories are canonicalized and deduplicated", () => {
  assert.deepEqual(
    normalizeSpendingCategories([" SaaS ", "saas", "API_Credits", ""]),
    ["saas", "api_credits"],
  );
});

test("spending policy rejects categories present in both lists", () => {
  assert.throws(
    () => assertNoSpendingCategoryOverlap(["saas", "cloud"], ["gambling", "saas"]),
    /cannot be both allowed and blocked/,
  );
});
