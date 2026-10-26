import type { ResourceProfile } from "./resource-profile.js";

export type AdaptiveFailureKind = "rate_limit" | "transient" | "fatal";

export type AdaptiveResourceState = {
  active: number;
  capacity: number;
  minCapacity: number;
  maxCapacity: number;
  latencyEwmaMs: number;
  successWindow: number;
  rateLimitedUntil: number | null;
  coolingUntil: number | null;
};

function boundedCooldown(baseMs: number, failures: number): number {
  return Math.min(120_000, Math.max(250, baseMs * 2 ** Math.min(7, Math.max(0, failures - 1))));
}

export class AdaptiveCapacityController {
  readonly #profile: ResourceProfile;
  #capacity: number;
  #latencyEwmaMs = 0;
  #successes = 0;
  #failureStreak = 0;
  #rateLimitedUntil: number | null = null;
  #coolingUntil: number | null = null;

  constructor(profile: ResourceProfile) {
    this.#profile = profile;
    // A configured resource contract is usable immediately. AIMD reduces it only when the
    // physical resource demonstrates that the starting capacity is too aggressive.
    this.#capacity = profile.maxCapacity;
  }

  get capacity(): number {
    return this.#capacity;
  }

  availabilityDelayMs(now = Date.now()): number {
    return Math.max(
      0,
      (this.#rateLimitedUntil ?? 0) - now,
      (this.#coolingUntil ?? 0) - now,
    );
  }

  recordSuccess(elapsedMs: number): void {
    if (Number.isFinite(elapsedMs) && elapsedMs >= 0) {
      const alpha = 0.2;
      this.#latencyEwmaMs = this.#latencyEwmaMs === 0
        ? elapsedMs
        : this.#latencyEwmaMs * (1 - alpha) + elapsedMs * alpha;
    }
    if (this.availabilityDelayMs() > 0) return;
    this.#failureStreak = 0;
    this.#rateLimitedUntil = null;
    this.#coolingUntil = null;
    this.#successes += 1;
    if (this.#successes >= this.#profile.successWindow && this.#capacity < this.#profile.maxCapacity) {
      this.#capacity += 1;
      this.#successes = 0;
    }
  }

  recordFailure(kind: AdaptiveFailureKind, retryAfterMs?: number): void {
    if (kind === "fatal") return;
    this.#successes = 0;
    this.#failureStreak += 1;
    this.#capacity = Math.max(
      this.#profile.minCapacity,
      Math.floor(this.#capacity * this.#profile.decreaseFactor),
    );
    const now = Date.now();
    if (kind === "rate_limit") {
      const delay = retryAfterMs && Number.isFinite(retryAfterMs) && retryAfterMs > 0
        ? retryAfterMs
        : boundedCooldown(5_000, this.#failureStreak);
      this.#rateLimitedUntil = now + delay;
      return;
    }
    this.#coolingUntil = now + boundedCooldown(750, this.#failureStreak);
  }

  snapshot(active: number): AdaptiveResourceState {
    return {
      active,
      capacity: this.#capacity,
      minCapacity: this.#profile.minCapacity,
      maxCapacity: this.#profile.maxCapacity,
      latencyEwmaMs: this.#latencyEwmaMs,
      successWindow: this.#successes,
      rateLimitedUntil: this.#rateLimitedUntil,
      coolingUntil: this.#coolingUntil,
    };
  }
}
