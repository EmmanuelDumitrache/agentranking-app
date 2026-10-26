import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPublicCredentialClaim,
  buildVerificationAnchorPayload,
  hashPublicCredentialClaim,
  hashVerificationAnchorPayload,
} from "../sap-anchor-payload.ts";

test("buildVerificationAnchorPayload is stable and contains no PII", () => {
  const payload = buildVerificationAnchorPayload({
    publicId: "AR-CMS43W0C8000",
    level: "INDIVIDUAL",
    verifiedAt: new Date("2026-08-09T06:09:05.182Z"),
    appAccountId: "cms43w0c80008i712bbdyarvf",
  });
  assert.equal(payload.v, 1);
  assert.equal(payload.publicId, "AR-CMS43W0C8000");
  assert.equal(payload.level, "INDIVIDUAL");
  assert.equal(
    Object.keys(payload).sort().join(","),
    "appAccountId,level,publicId,v,verifiedAt",
  );
});

test("hashVerificationAnchorPayload returns 32-byte digest", () => {
  const payload = buildVerificationAnchorPayload({
    publicId: "AR-TEST",
    level: "INDIVIDUAL",
    verifiedAt: new Date("2026-01-01T00:00:00.000Z"),
    appAccountId: "acct_1",
  });
  const first = hashVerificationAnchorPayload(payload);
  const second = hashVerificationAnchorPayload(payload);
  assert.equal(first.hex, second.hex);
  assert.equal(first.bytes.length, 32);
});

test("public credential claim hash excludes internal account ids", () => {
  const claim = buildPublicCredentialClaim({
    publicId: "AR-CMS43W0C8000",
    level: "INDIVIDUAL",
    status: "VERIFIED",
    verifiedAt: new Date("2026-08-19T00:00:00.000Z"),
  });
  assert.equal(
    Object.keys(claim).sort().join(","),
    "level,publicId,schemaVersion,status,v,verifiedAt",
  );
  const hashed = hashPublicCredentialClaim(claim);
  assert.equal(hashed.bytes.length, 32);
  assert.equal(hashPublicCredentialClaim(claim).hex, hashed.hex);
});
