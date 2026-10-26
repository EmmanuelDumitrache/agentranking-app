import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { PersonaKycProvider } from "../providers/kyc/persona.ts";

test("PersonaKycProvider parseWebhookEvent maps approved inquiry", () => {
  const provider = new PersonaKycProvider();
  const payload = {
    data: {
      id: "evt_test_1",
      type: "event",
      attributes: {
        name: "inquiry.approved",
        payload: {
          data: {
            id: "inq_test_1",
            type: "inquiry",
            attributes: {
              status: "approved",
              "reference-id": "acct_cuid_123",
            },
          },
        },
      },
    },
  };

  const event = provider.parseWebhookEvent(payload);
  assert.ok(event);
  assert.equal(event.eventId, "evt_test_1");
  assert.equal(event.inquiryId, "inq_test_1");
  assert.equal(event.referenceId, "acct_cuid_123");
  assert.equal(event.status, "approved");
});

test("PersonaKycProvider verifyWebhook validates Persona-Signature header", () => {
  const provider = new PersonaKycProvider();
  const secret = "wbhsec_test_secret";
  const previous = process.env.PERSONA_WEBHOOK_SECRET;
  process.env.PERSONA_WEBHOOK_SECRET = secret;

  const body = JSON.stringify({ data: { type: "event" } });
  const timestamp = "1700000000";
  const v1 = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  const header = `t=${timestamp},v1=${v1}`;

  assert.equal(provider.verifyWebhook(body, header), true);
  assert.equal(provider.verifyWebhook(body, "t=1,v1=deadbeef"), false);

  if (previous === undefined) delete process.env.PERSONA_WEBHOOK_SECRET;
  else process.env.PERSONA_WEBHOOK_SECRET = previous;
});
