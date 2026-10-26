import assert from "node:assert/strict";
import test from "node:test";
import {
  cardIssuanceRequiresPayment,
  getCardIssuanceFeeCents,
  getCardIssuanceQuote,
  isCardIssuanceDevBypassActive,
} from "../config.ts";

const originalEnv = { ...process.env };

test.afterEach(() => {
  process.env = { ...originalEnv };
});

test("default issuance fee is $25", () => {
  delete process.env.CARD_ISSUANCE_FEE_CENTS;
  delete process.env.CARD_ISSUANCE_DEV_BYPASS;
  process.env.NODE_ENV = "test";
  assert.equal(getCardIssuanceFeeCents(), 2500);
  assert.equal(cardIssuanceRequiresPayment(), true);
});

test("dev bypass only applies outside production", () => {
  process.env.NODE_ENV = "development";
  process.env.CARD_ISSUANCE_DEV_BYPASS = "true";
  assert.equal(isCardIssuanceDevBypassActive(), true);
  assert.equal(cardIssuanceRequiresPayment(), false);

  process.env.NODE_ENV = "production";
  assert.equal(isCardIssuanceDevBypassActive(), false);
  assert.equal(cardIssuanceRequiresPayment(), true);
});

test("quote reflects fee and bypass state", () => {
  process.env.NODE_ENV = "development";
  process.env.CARD_ISSUANCE_FEE_CENTS = "9900";
  process.env.CARD_ISSUANCE_DEV_BYPASS = "true";
  const quote = getCardIssuanceQuote();
  assert.equal(quote.feeCents, 9900);
  assert.equal(quote.requiresPayment, false);
  assert.equal(quote.devBypassActive, true);
});
