import "server-only";

import {
  Connection,
  type Commitment,
  type ConnectionConfig,
  type FetchFn,
} from "@solana/web3.js";

export type TimedSolanaConnectionOptions = {
  commitment: Commitment;
  signal: AbortSignal;
  /** Public summary reads should fail fast so one 429 does not fan out into web3.js retry storms. */
  disableRetryOnRateLimit?: boolean;
};

/**
 * Solana web3.js uses a fetch-compatible transport. Compose its per-request
 * signal with the caller's absolute operation deadline so cancellation reaches
 * the actual JSON-RPC request instead of merely abandoning the awaiting code.
 */
export function createAbortableSolanaFetch(
  operationSignal: AbortSignal,
): FetchFn {
  return ((input, init) => {
    const requestSignal = init?.signal
      ? AbortSignal.any([
          operationSignal,
          init.signal as unknown as AbortSignal,
        ])
      : operationSignal;

    return globalThis.fetch(input as never, {
      ...(init ?? {}),
      signal: requestSignal,
    } as never) as never;
  }) as FetchFn;
}

export function createTimedSolanaConnectionConfig({
  commitment,
  signal,
  disableRetryOnRateLimit = true,
}: TimedSolanaConnectionOptions): ConnectionConfig {
  return {
    commitment,
    fetch: createAbortableSolanaFetch(signal),
    disableRetryOnRateLimit,
  };
}

export function createTimedSolanaConnection(
  endpoint: string,
  options: TimedSolanaConnectionOptions,
): Connection {
  return new Connection(
    endpoint,
    createTimedSolanaConnectionConfig(options),
  );
}
