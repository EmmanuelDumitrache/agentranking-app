import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  consumeBackupCode,
  generateBackupCodes,
  hashBackupCodes,
  normalizeBackupCode,
} from "../backup-codes.js";
import { generateTotpSecret, verifyTotpCode, buildTotp } from "../totp.js";
import { isWhatsNewUnread, WHATS_NEW_LATEST_ID } from "../../../content/whats-new.js";
import { getMfaFactorFlags } from "../flags.js";
import { issueMfaTrustToken, readMfaTrustToken, verifyMfaTrustToken } from "../mfa-trust-token.js";
describe("backup codes", () => {
  it("generates and consumes a matching code once", async () => {
    const codes = generateBackupCodes(3);
    assert.equal(codes.length, 3);
    const hashes = await hashBackupCodes(codes);
    const remaining = await consumeBackupCode(hashes, codes[0]!);
    assert.ok(remaining);
    assert.equal(remaining.length, 2);
    const again = await consumeBackupCode(remaining, codes[0]!);
    assert.equal(again, null);
  });
  it("normalizes separators", () => {
    assert.equal(normalizeBackupCode("abcd-efgh"), "ABCDEFGH");
  });
});
describe("totp", () => {
  it("verifies a current code", () => {
    const secret = generateTotpSecret();
    const token = buildTotp(secret, "test").generate();
    assert.equal(verifyTotpCode(secret, token), true);
    assert.equal(verifyTotpCode(secret, "000000"), false);
  });
});
describe("mfa flags", () => {
  it("requires mfa when totp or email otp is on", () => {
    const off = getMfaFactorFlags({
      totpEnabledAt: null,
      totpSecretEnc: null,
      totpBackupCodesHash: [],
      emailOtpMfaEnabledAt: null,
      email: "a@example.com",
      emailVerifiedAt: new Date(),
    });
    assert.equal(off.mfaRequired, false);
    const totp = getMfaFactorFlags({
      totpEnabledAt: new Date(),
      totpSecretEnc: "enc",
      totpBackupCodesHash: ["x"],
      emailOtpMfaEnabledAt: null,
      email: "a@example.com",
      emailVerifiedAt: new Date(),
    });
    assert.equal(totp.mfaRequired, true);
    assert.equal(totp.totpEnabled, true);
  });
});
describe("mfa trust token", () => {
  it("accepts a token only for the matching profile", () => {
    process.env.NEXTAUTH_SECRET =
      process.env.NEXTAUTH_SECRET?.trim() || "test-nextauth-secret-at-least-32-chars!!";
    const token = issueMfaTrustToken(42, 3);
    assert.equal(verifyMfaTrustToken(token, 42, 3).ok, true);
    assert.equal(verifyMfaTrustToken(token, 99, 3).ok, false);
    assert.equal(verifyMfaTrustToken(token, 42, 4).ok, false);
    assert.equal(verifyMfaTrustToken(`tampered.${token.split(".")[1]}`, 42, 3).ok, false);
  });
  it("exposes expiry via readMfaTrustToken", () => {
    process.env.NEXTAUTH_SECRET =
      process.env.NEXTAUTH_SECRET?.trim() || "test-nextauth-secret-at-least-32-chars!!";
    const before = Date.now();
    const token = issueMfaTrustToken(7, 0);
    const read = readMfaTrustToken(token, 7, 0);
    assert.equal(read.ok, true);
    if (read.ok) {
      assert.ok(read.expiresAt > before);
      assert.ok(read.expiresAt <= before + 7 * 24 * 60 * 60 * 1000 + 5_000);
    }
  });
});
describe("whats new unread", () => {
  it("treats missing seen id as unread", () => {
    assert.equal(isWhatsNewUnread(null), true);
    assert.equal(isWhatsNewUnread(WHATS_NEW_LATEST_ID), false);
  });
});