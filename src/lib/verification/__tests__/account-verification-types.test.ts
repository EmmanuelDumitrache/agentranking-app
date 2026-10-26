import assert from "node:assert/strict";
import test from "node:test";
import {
  isAccountVerifiedStatus,
  toPublicCredential,
} from "../account-verification-types.ts";

test("isAccountVerifiedStatus requires VERIFIED and non-expired", () => {
  const future = new Date(Date.now() + 60_000);
  const past = new Date(Date.now() - 60_000);
  assert.equal(isAccountVerifiedStatus("VERIFIED", future), true);
  assert.equal(isAccountVerifiedStatus("VERIFIED", past), false);
  assert.equal(isAccountVerifiedStatus("PENDING", null), false);
});

test("toPublicCredential exposes no PII fields", () => {
  const credential = toPublicCredential({
    publicId: "AR-ABC123",
    level: "INDIVIDUAL",
    status: "VERIFIED",
    verifiedAt: new Date("2026-01-01T00:00:00.000Z"),
    expiresAt: null,
  });
  assert.equal(credential.publicId, "AR-ABC123");
  assert.equal(credential.schemaVersion, 1);
  assert.equal(Object.keys(credential).sort().join(","), "expiresAt,level,publicId,schemaVersion,status,verifiedAt");
});
