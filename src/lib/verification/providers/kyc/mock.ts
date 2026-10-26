import type { KycProvider, KycSessionStatus } from "../types";

/**
 * Demo KYC provider. Always approves after a short delay.
 * Never returns or stores PII.
 */
export class MockKycProvider implements KycProvider {
  readonly name = "mock";

  private readonly sessions = new Map<
    string,
    { status: KycSessionStatus; createdAt: number; providerRef: string }
  >();

  async createSession(params: {
    referenceId: string;
    callbackUrl: string;
  }): Promise<{ sessionId: string; url: string }> {
    const sessionId = `mock_sess_${params.referenceId}_${Date.now()}`;
    const providerRef = `mock_ref_${params.referenceId}`;
    this.sessions.set(sessionId, {
      status: "pending",
      createdAt: Date.now(),
      providerRef,
    });
    const url = new URL(params.callbackUrl);
    url.searchParams.set("sessionId", sessionId);
    url.searchParams.set("provider", this.name);
    return { sessionId, url: url.toString() };
  }

  async getStatus(sessionId: string): Promise<{
    status: KycSessionStatus;
    providerRef: string;
    completedAt?: Date;
  }> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { status: "expired", providerRef: "unknown" };
    }
    const ageMs = Date.now() - session.createdAt;
    if (ageMs >= 3_000 && session.status === "pending") {
      session.status = "approved";
    }
    return {
      status: session.status,
      providerRef: session.providerRef,
      completedAt: session.status === "approved" ? new Date() : undefined,
    };
  }

  verifyWebhook(_payload: unknown, signature: string): boolean {
    return signature === "mock-signature";
  }
}
