import assert from "node:assert/strict";
import test from "node:test";
import {
  getCardIssuerProvider,
  getKripicardCardIssuer,
  getPaymentProvider,
  isKripicardIssuerActive,
} from "../providers/index.ts";
import { parseKripicardExpiry, normalizeKripicardCardDetails } from "../providers/card/kripicard-api.ts";

test("funding provider factory defaults to mock", () => {
  delete process.env.FUNDING_PROVIDER;
  assert.equal(getPaymentProvider().name, "mock");
});

test("funding provider factory maps kripicard", () => {
  process.env.FUNDING_PROVIDER = "kripicard";
  assert.equal(getPaymentProvider().name, "kripicard");
  process.env.FUNDING_PROVIDER = "mock";
});

test("card issuer factory defaults to mock", () => {
  delete process.env.CARD_ISSUER_PROVIDER;
  assert.equal(getCardIssuerProvider().name, "mock");
});

test("card issuer factory maps ar/kripicard aliases", () => {
  process.env.CARD_ISSUER_PROVIDER = "kripicard";
  assert.equal(getCardIssuerProvider().name, "ar");
  assert.equal(isKripicardIssuerActive(), true);
  process.env.CARD_ISSUER_PROVIDER = "ar";
  assert.equal(getCardIssuerProvider().name, "ar");
  process.env.CARD_ISSUER_PROVIDER = "mock";
});

test("mock funding create + confirm roundtrip", async () => {
  process.env.FUNDING_PROVIDER = "mock";
  const provider = getPaymentProvider();
  const intent = await provider.createFundingIntent({
    appAccountId: "acct_test",
    amountCents: 2500,
    currency: "USDC",
    idempotencyKey: "idem-1",
    returnUrl: "https://example.com/return",
  });
  assert.ok(intent.providerIntentId);
  const confirmed = await provider.confirmFunding({
    providerIntentId: intent.providerIntentId,
  });
  assert.equal(confirmed.confirmed, true);
  assert.equal(confirmed.amountCents, 2500);
});

test("mock card issue returns tokenized fields only", async () => {
  process.env.CARD_ISSUER_PROVIDER = "mock";
  const issuer = getCardIssuerProvider();
  const card = await issuer.issueCard({
    appAccountId: "acct_card",
    idempotencyKey: "card-1",
  });
  assert.equal(card.lastFour.length, 4);
  assert.ok(card.providerCardId);
  const details = await issuer.getCardDetails(card.providerCardId);
  assert.equal(details.revealMode, "inline");
  assert.ok(details.credentials?.pan);
  assert.ok(details.credentials?.cvv);
  assert.equal("pan" in card, false);
  assert.equal("cvv" in card, false);
});

test("parseKripicardExpiry handles MM/YY and MMYY", () => {
  assert.deepEqual(parseKripicardExpiry("12/27"), { expiryMonth: 12, expiryYear: 2027 });
  assert.deepEqual(parseKripicardExpiry("0830"), { expiryMonth: 8, expiryYear: 2030 });
  assert.deepEqual(parseKripicardExpiry(undefined), { expiryMonth: null, expiryYear: null });
});

test("normalizeKripicardCardDetails handles flat and nested payloads", () => {
  assert.deepEqual(
    normalizeKripicardCardDetails({
      success: true,
      card_number: "5395020000001234",
      expiry: "12/27",
      cvv: "123",
      balance: 20,
      status: "active",
    }),
    {
      cardNumber: "5395020000001234",
      cvv: "123",
      expiry: "12/27",
      balance: 20,
      status: "active",
    },
  );

  assert.deepEqual(
    normalizeKripicardCardDetails({
      success: true,
      data: {
        details: {
          pan: "4111111111111111",
          cvc: "999",
          expiry: "08/30",
          balance: 15,
          status: "active",
        },
      },
    }),
    {
      cardNumber: "4111111111111111",
      cvv: "999",
      expiry: "08/30",
      balance: 15,
      status: "active",
    },
  );
});

test("kripicard issuer exposes prepaid helpers", () => {
  process.env.CARD_ISSUER_PROVIDER = "ar";
  const issuer = getKripicardCardIssuer();
  assert.equal(issuer.name, "ar");
  assert.equal(issuer.supportsPrepaidBalance, true);
  process.env.CARD_ISSUER_PROVIDER = "mock";
});
