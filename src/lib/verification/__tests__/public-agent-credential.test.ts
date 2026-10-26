import assert from "node:assert/strict";
import test from "node:test";
import {
  credentialProofPath,
  toPublicAgentCredential,
} from "../public-agent-credential.ts";

test("toPublicAgentCredential is absent without a public id", () => {
  assert.deepEqual(
    toPublicAgentCredential({
      verificationStatus: "VERIFIED",
      verificationExpiresAt: null,
    }),
    { present: false },
  );
});

test("toPublicAgentCredential is absent when KYC is not active", () => {
  assert.deepEqual(
    toPublicAgentCredential({
      publicId: "AR-ABC123",
      verificationLevel: "INDIVIDUAL",
      verificationStatus: "UNVERIFIED",
      verificationExpiresAt: null,
    }),
    { present: false },
  );
  assert.deepEqual(
    toPublicAgentCredential({
      publicId: "AR-ABC123",
      verificationLevel: "INDIVIDUAL",
      verificationStatus: "VERIFIED",
      verificationExpiresAt: new Date("2020-01-01"),
    }),
    { present: false },
  );
});

test("toPublicAgentCredential exposes the public AR id and proof path only", () => {
  const credential = toPublicAgentCredential({
    publicId: "AR-CMS43W0C8000",
    verificationLevel: "INDIVIDUAL",
    verificationStatus: "VERIFIED",
    verifiedAt: new Date("2026-08-19T00:00:00.000Z"),
    verificationExpiresAt: null,
  });
  assert.equal(credential.present, true);
  if (!credential.present) return;
  assert.equal(credential.publicId, "AR-CMS43W0C8000");
  assert.equal(credential.level, "INDIVIDUAL");
  assert.equal(credential.status, "VERIFIED");
  assert.equal(credential.schemaVersion, 1);
  assert.equal(credential.proofPath, credentialProofPath("AR-CMS43W0C8000"));
  assert.equal(
    Object.keys(credential).sort().join(","),
    "expiresAt,level,present,proofPath,publicId,schemaVersion,status,verifiedAt",
  );
});
