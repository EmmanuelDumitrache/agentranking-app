import type { KycProvider, KycSessionStatus } from "../types";

/**
 * Stub KYC adapter for a hosted identity provider.
 *
 * TODO(Phase 2): Implement session creation against the configured provider SDK.
 * TODO(Phase 2): Map provider webhook events → status only (never persist PII).
 * TODO(Phase 2): Verify webhook signatures with provider secrets from env.
 *
 * Partner selection is env-driven via KYC_PROVIDER — do not hardcode brands in callers.
 */
export class HostedKycProviderStub implements KycProvider {
  readonly name = "civic";

  async createSession(_params: {
    referenceId: string;
    callbackUrl: string;
  }): Promise<{ sessionId: string; url: string }> {
    // TODO(Phase 2): call provider API with KYC_PROVIDER_API_KEY / KYC_PROVIDER_BASE_URL
    throw new Error(
      "HostedKycProviderStub.createSession is not implemented. Set KYC_PROVIDER=mock for demo.",
    );
  }

  async getStatus(_sessionId: string): Promise<{
    status: KycSessionStatus;
    providerRef: string;
    completedAt?: Date;
  }> {
    // TODO(Phase 2): poll provider by session id; return status + opaque providerRef only
    throw new Error(
      "HostedKycProviderStub.getStatus is not implemented. Set KYC_PROVIDER=mock for demo.",
    );
  }

  verifyWebhook(_payload: unknown, _signature: string): boolean {
    // TODO(Phase 2): HMAC verify with KYC_PROVIDER_WEBHOOK_SECRET
    return false;
  }
}
