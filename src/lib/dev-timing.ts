/** Dev-only timing logs (console). Enable with DEV_TIMING=1. */
export async function devTimed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (process.env.DEV_TIMING !== "1") {
    return fn();
  }
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    console.info(`[dev-timing] ${label} ${(performance.now() - t0).toFixed(0)}ms`);
  }
}