import "server-only";

type Waiter = {
  resolve: () => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
};

type Semaphore = {
  active: number;
  waiters: Waiter[];
};

const semaphores = new Map<string, Semaphore>();

async function acquire(key: string, limit: number, signal?: AbortSignal): Promise<() => void> {
  const semaphore = semaphores.get(key) ?? { active: 0, waiters: [] };
  semaphores.set(key, semaphore);
  if (semaphore.active < limit) {
    semaphore.active += 1;
    return () => release(key, semaphore);
  }
  await new Promise<void>((resolve, reject) => {
    const waiter: Waiter = { resolve, reject, signal };
    semaphore.waiters.push(waiter);
    signal?.addEventListener("abort", () => {
      const index = semaphore.waiters.indexOf(waiter);
      if (index >= 0) semaphore.waiters.splice(index, 1);
      reject(signal.reason ?? new Error("MCP invocation cancelled"));
    }, { once: true });
  });
  // release() transfers the occupied permit directly to this waiter. Do not
  // increment here: another acquire could otherwise observe the temporary gap
  // between release and this continuation and oversubscribe the semaphore.
  return () => release(key, semaphore);
}

function release(key: string, semaphore: Semaphore): void {
  while (semaphore.waiters.length) {
    const waiter = semaphore.waiters.shift()!;
    if (waiter.signal?.aborted) continue;
    waiter.resolve();
    return;
  }
  semaphore.active = Math.max(0, semaphore.active - 1);
  if (semaphore.active === 0 && semaphore.waiters.length === 0) semaphores.delete(key);
}

export async function withMcpInvocationConcurrency<T>(params: {
  appAccountId: string;
  connectionId: string;
  bindingId: string;
  maxParallelCalls: number;
  signal?: AbortSignal;
  operation: () => Promise<T>;
}): Promise<T> {
  const accountRelease = await acquire(`account:${params.appAccountId}`, 8, params.signal);
  let connectionRelease: (() => void) | null = null;
  let bindingRelease: (() => void) | null = null;
  try {
    connectionRelease = await acquire(
      `connection:${params.connectionId}`,
      4,
      params.signal,
    );
    bindingRelease = await acquire(
      `binding:${params.bindingId}`,
      Math.max(1, Math.min(4, params.maxParallelCalls)),
      params.signal,
    );
    return await params.operation();
  } finally {
    bindingRelease?.();
    connectionRelease?.();
    accountRelease();
  }
}
