import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getPublicAgentVerificationStatus,
  isOwnerAccountVerified,
  withInheritedAgentVerification,
} from "@/lib/public-site/agent-verification";
import { isDashboardAgentVerified } from "@/lib/dashboard/agent-verification-display";

describe("withInheritedAgentVerification", () => {
  it("inherits verified status from owner account KYC", () => {
    const resolved = withInheritedAgentVerification({
      arVerificationStatus: "unverified",
      isVerified: false,
      ownerAccount: {
        verificationStatus: "VERIFIED",
        verificationExpiresAt: null,
      },
    });

    assert.equal(resolved.ownerAccountVerified, true);
    assert.equal(resolved.arVerificationStatus, "verified");
    assert.equal(resolved.isVerified, true);
    assert.equal(getPublicAgentVerificationStatus(resolved).source, "account");
  });

  it("does not inherit when owner account is unverified", () => {
    const resolved = withInheritedAgentVerification({
      arVerificationStatus: "unverified",
      isVerified: false,
      ownerAccount: {
        verificationStatus: "UNVERIFIED",
        verificationExpiresAt: null,
      },
    });

    assert.equal(resolved.ownerAccountVerified, false);
    assert.equal(resolved.arVerificationStatus, "unverified");
    assert.equal(getPublicAgentVerificationStatus(resolved).isVerified, false);
  });

  it("respects verification expiry on owner account", () => {
    assert.equal(
      isOwnerAccountVerified({
        verificationStatus: "VERIFIED",
        verificationExpiresAt: new Date("2020-01-01"),
      }),
      false,
    );
  });

  it("dashboard badge requires live account verification", () => {
    assert.equal(
      isDashboardAgentVerified(
        { arVerificationStatus: "verified", isVerified: false, isPremiumVerified: false },
        false,
      ),
      true,
    );
    assert.equal(
      isDashboardAgentVerified(
        { arVerificationStatus: "unverified", isVerified: false, isPremiumVerified: false },
        false,
      ),
      false,
    );
    assert.equal(
      isDashboardAgentVerified(
        { arVerificationStatus: "unverified", isVerified: false, isPremiumVerified: false },
        true,
      ),
      true,
    );
  });
});
