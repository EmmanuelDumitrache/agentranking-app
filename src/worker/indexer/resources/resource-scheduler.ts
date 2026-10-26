import { throwIfAborted } from "../lib/abort.js";
import { AdaptiveCapacityController, type AdaptiveFailureKind } from "./adaptive-capacity.js";
import { acquireDistributedResourceSlot } from "./distributed-resource-lease.js";
import {
  distributedResourceAvailability,
  recordDistributedResourceFailure,
  recordDistributedResourceSuccess,
  type DistributedResourceAvailability,
} from "./distributed-resource-state.js";
import type { ResourceProfile } from "./resource-profile.js";
import type { ResourceKey } from "./resource-key.js";
type ResourceTaskOptions<T> = {
  signal?: AbortSignal;
  priority?: number;
  classifyFailure?: (error: unknown) => { kind: AdaptiveFailureKind; retryAfterMs?: number };
  classifyResult?: (value: T) => { kind: AdaptiveFailureKind; retryAfterMs?: number } | null;
};
type Waiter = {
  priority: number;
  sequence: number;
  heapIndex: number;
  signal?: AbortSignal;
  resolve(): void;
  reject(error: unknown): void;
};
const schedulerRegistry = new Map<ResourceKey, ResourceScheduler>();
function retryAfterMsFromError(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const record = error as Record<string, unknown>;
  const direct = record.retryAfterMs;
  if (typeof direct === "number" && Number.isFinite(direct) && direct > 0) return direct;
  return undefined;
}
function defaultFailureClassification(error: unknown): { kind: AdaptiveFailureKind; retryAfterMs?: number } {
  const status = error && typeof error === "object" && "status" in error
    ? Number((error as { status?: unknown }).status)
    : Number.NaN;
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  if (status === 429 || /rate.?limit|too many requests|quota/i.test(text)) {
    return { kind: "rate_limit", retryAfterMs: retryAfterMsFromError(error) };
  }
  if (status === 502 || status === 503 || status === 504 || /timeout|timed out|ECONNRESET|EPIPE|socket|network|fetch failed/i.test(text)) {
    return { kind: "transient" };
  }
  return { kind: "fatal" };
}
export class ResourceScheduler {
  readonly #resourceKey: ResourceKey;
  readonly #profile: ResourceProfile;
  readonly #adaptive: AdaptiveCapacityController;
  readonly #waiters: Waiter[] = [];
  #active = 0;
  #sharedCapacity: number;
  #sharedRateLimitedUntil: number | null = null;
  #sharedCoolingUntil: number | null = null;
  #sequence = 0;
  #wakeTimer: NodeJS.Timeout | null = null;
  #idleWaiters: Array<() => void> = [];
  constructor(resourceKey: ResourceKey, profile: ResourceProfile) {
    if (schedulerRegistry.has(resourceKey)) {
      throw new Error(`Resource scheduler already registered for ${resourceKey}`);
    }
    this.#resourceKey = resourceKey;
    this.#profile = profile;
    this.#adaptive = new AdaptiveCapacityController(profile);
    this.#sharedCapacity = profile.maxCapacity;
    schedulerRegistry.set(resourceKey, this);
  }
  get resourceKey(): ResourceKey {
    return this.#resourceKey;
  }
  async run<T>(
    task: (signal: AbortSignal | undefined) => Promise<T>,
    options: ResourceTaskOptions<T> = {},
  ): Promise<T> {
    // Admit locally before consulting PostgreSQL. Callers beyond the local
    // capacity remain entirely in memory instead of each issuing the same
    // distributed-state read while they wait for an executable slot.
    await this.#acquireLocal(options);
    let lease: Awaited<ReturnType<typeof acquireDistributedResourceSlot>> | null = null;
    let value: T | undefined;
    let primaryError: unknown;
    try {
      const initialSharedAvailability = await this.#refreshSharedAvailability();
      let initialAvailabilityPending = true;
      lease = await acquireDistributedResourceSlot({
        resourceKey: this.#resourceKey,
        capacity: () => {
          if (initialAvailabilityPending) {
            initialAvailabilityPending = false;
            if (initialSharedAvailability.waitMs === 0) {
              return Promise.resolve(initialSharedAvailability);
            }
          }
          return this.#refreshSharedAvailability();
        },
        enforceDistributedState: true,
        leaseTtlMs: this.#profile.leaseTtlMs,
        heartbeatMs: this.#profile.leaseHeartbeatMs,
        pollMs: this.#profile.leaseAcquirePollMs,
        signal: options.signal,
      });
      const taskSignal = options.signal
        ? AbortSignal.any([options.signal, lease.signal])
        : lease.signal;
      // AIMD latency represents the physical provider operation. Counting
      // distributed admission wait here makes capacity react to its own queue.
      const startedAt = performance.now();
      value = await task(taskSignal);
      throwIfAborted(lease.signal);
      const classifiedResult = options.classifyResult?.(value) ?? null;
      if (classifiedResult) {
        this.#adaptive.recordFailure(classifiedResult.kind, classifiedResult.retryAfterMs);
        await this.#recordSharedFailure(classifiedResult.kind, classifiedResult.retryAfterMs);
      } else {
        const elapsedMs = performance.now() - startedAt;
        this.#adaptive.recordSuccess(elapsedMs);
        await this.#recordSharedSuccess(elapsedMs);
      }
    } catch (error) {
      primaryError = error;
      const classified = (options.classifyFailure ?? defaultFailureClassification)(error);
      this.#adaptive.recordFailure(classified.kind, classified.retryAfterMs);
      if (lease && !lease.signal.aborted) {
        try {
          await this.#recordSharedFailure(classified.kind, classified.retryAfterMs);
        } catch (stateError) {
          primaryError = new AggregateError(
            [error, stateError],
            `Resource task and distributed failure-state update failed for ${this.#resourceKey}`,
          );
        }
      }
    }

    const cleanupErrors: unknown[] = [];
    try {
      if (lease) await lease.release();
    } catch (error) {
      cleanupErrors.push(error);
    } finally {
      this.#active -= 1;
      this.#drainWaiters();
      this.#resolveIdleIfNeeded();
    }

    const errors = primaryError === undefined ? cleanupErrors : [primaryError, ...cleanupErrors];
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, `Resource scheduler operation failed for ${this.#resourceKey}`);
    }
    return value as T;
  }
  async onIdle(): Promise<void> {
    if (this.#active === 0 && this.#waiters.length === 0) return;
    await new Promise<void>((resolve) => this.#idleWaiters.push(resolve));
  }
  #acquireLocal<T>(options: ResourceTaskOptions<T>): Promise<void> {
    throwIfAborted(options.signal);
    if (this.#canStart()) {
      this.#active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        priority: options.priority ?? 0,
        sequence: this.#sequence++,
        heapIndex: -1,
        signal: options.signal,
        resolve,
        reject,
      };
      const abort = () => {
        if (!this.#removeWaiter(waiter)) return;
        reject(options.signal?.reason ?? new DOMException("Aborted", "AbortError"));
        this.#resolveIdleIfNeeded();
      };
      options.signal?.addEventListener("abort", abort, { once: true });
      const originalResolve = waiter.resolve;
      waiter.resolve = () => {
        options.signal?.removeEventListener("abort", abort);
        originalResolve();
      };
      this.#pushWaiter(waiter);
      if (options.signal?.aborted) {
        abort();
        return;
      }
      this.#scheduleWakeForCooldown();
    });
  }

  #waiterPrecedes(left: Waiter, right: Waiter): boolean {
    return left.priority > right.priority ||
      (left.priority === right.priority && left.sequence < right.sequence);
  }

  #swapWaiters(left: number, right: number): void {
    const leftWaiter = this.#waiters[left]!;
    const rightWaiter = this.#waiters[right]!;
    this.#waiters[left] = rightWaiter;
    this.#waiters[right] = leftWaiter;
    rightWaiter.heapIndex = left;
    leftWaiter.heapIndex = right;
  }

  #siftWaiterUp(index: number): void {
    let current = index;
    while (current > 0) {
      const parent = (current - 1) >>> 1;
      if (!this.#waiterPrecedes(this.#waiters[current]!, this.#waiters[parent]!)) break;
      this.#swapWaiters(current, parent);
      current = parent;
    }
  }

  #siftWaiterDown(index: number): void {
    let current = index;
    for (;;) {
      const left = current * 2 + 1;
      if (left >= this.#waiters.length) return;
      const right = left + 1;
      const next = right < this.#waiters.length &&
          this.#waiterPrecedes(this.#waiters[right]!, this.#waiters[left]!)
        ? right
        : left;
      if (!this.#waiterPrecedes(this.#waiters[next]!, this.#waiters[current]!)) return;
      this.#swapWaiters(current, next);
      current = next;
    }
  }

  #pushWaiter(waiter: Waiter): void {
    waiter.heapIndex = this.#waiters.length;
    this.#waiters.push(waiter);
    this.#siftWaiterUp(waiter.heapIndex);
  }

  #popWaiter(): Waiter | undefined {
    const first = this.#waiters[0];
    if (!first) return undefined;
    const last = this.#waiters.pop()!;
    first.heapIndex = -1;
    if (last !== first) {
      this.#waiters[0] = last;
      last.heapIndex = 0;
      this.#siftWaiterDown(0);
    }
    return first;
  }

  #removeWaiter(waiter: Waiter): boolean {
    const index = waiter.heapIndex;
    if (index < 0 || this.#waiters[index] !== waiter) return false;
    const last = this.#waiters.pop()!;
    waiter.heapIndex = -1;
    if (last === waiter) return true;
    this.#waiters[index] = last;
    last.heapIndex = index;
    const parent = index > 0 ? (index - 1) >>> 1 : -1;
    if (parent >= 0 && this.#waiterPrecedes(last, this.#waiters[parent]!)) {
      this.#siftWaiterUp(index);
    } else {
      this.#siftWaiterDown(index);
    }
    return true;
  }

  #canStart(): boolean {
    return this.#active < Math.min(this.#adaptive.capacity, this.#sharedCapacity)
      && Math.max(this.#adaptive.availabilityDelayMs(), this.#sharedAvailabilityDelayMs()) === 0;
  }
  #drainWaiters(): void {
    while (this.#waiters.length > 0 && this.#canStart()) {
      const waiter = this.#popWaiter()!;
      if (waiter.signal?.aborted) {
        waiter.reject(waiter.signal.reason ?? new DOMException("Aborted", "AbortError"));
        continue;
      }
      this.#active += 1;
      waiter.resolve();
    }
    this.#scheduleWakeForCooldown();
  }
  #scheduleWakeForCooldown(): void {
    if (this.#wakeTimer) clearTimeout(this.#wakeTimer);
    this.#wakeTimer = null;
    if (this.#waiters.length === 0) return;
    const delay = Math.max(this.#adaptive.availabilityDelayMs(), this.#sharedAvailabilityDelayMs());
    if (delay <= 0) return;
    this.#wakeTimer = setTimeout(() => {
      this.#wakeTimer = null;
      this.#drainWaiters();
    }, delay);
  }
  #sharedAvailabilityDelayMs(now = Date.now()): number {
    return Math.max(
      0,
      (this.#sharedRateLimitedUntil ?? 0) - now,
      (this.#sharedCoolingUntil ?? 0) - now,
    );
  }
  #applySharedAvailability(state: DistributedResourceAvailability): void {
    this.#sharedCapacity = state.capacity;
    this.#sharedRateLimitedUntil = state.rateLimitedUntil?.getTime() ?? null;
    this.#sharedCoolingUntil = state.coolingUntil?.getTime() ?? null;
    this.#scheduleWakeForCooldown();
  }
  async #refreshSharedAvailability(): Promise<DistributedResourceAvailability> {
    const state = await distributedResourceAvailability(this.#resourceKey, this.#profile);
    this.#applySharedAvailability(state);
    return state;
  }
  async #recordSharedSuccess(elapsedMs: number): Promise<void> {
    let state = await recordDistributedResourceSuccess(this.#resourceKey, elapsedMs);
    if (!state) {
      await distributedResourceAvailability(this.#resourceKey, this.#profile);
      state = await recordDistributedResourceSuccess(this.#resourceKey, elapsedMs);
    }
    if (!state) {
      throw new Error(`Distributed resource success state was not updated for ${this.#resourceKey}`);
    }
    this.#applySharedAvailability(state);
  }
  async #recordSharedFailure(kind: AdaptiveFailureKind, retryAfterMs?: number): Promise<void> {
    // Fatal failures intentionally do not alter the shared AIMD state.
    if (kind === "fatal") return;
    let state = await recordDistributedResourceFailure(this.#resourceKey, kind, retryAfterMs);
    if (!state) {
      await distributedResourceAvailability(this.#resourceKey, this.#profile);
      state = await recordDistributedResourceFailure(this.#resourceKey, kind, retryAfterMs);
    }
    if (!state) {
      throw new Error(`Distributed resource failure state was not updated for ${this.#resourceKey}`);
    }
    this.#applySharedAvailability(state);
  }
  #resolveIdleIfNeeded(): void {
    if (this.#active !== 0 || this.#waiters.length !== 0) return;
    for (const resolve of this.#idleWaiters.splice(0)) resolve();
  }
}
export function getOrCreateResourceScheduler(
  resourceKey: ResourceKey,
  profile: ResourceProfile,
): ResourceScheduler {
  return schedulerRegistry.get(resourceKey) ?? new ResourceScheduler(resourceKey, profile);
}
export async function drainResourceSchedulers(): Promise<void> {
  await Promise.all([...schedulerRegistry.values()].map((scheduler) => scheduler.onIdle()));
}
