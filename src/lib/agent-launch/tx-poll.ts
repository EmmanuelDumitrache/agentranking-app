import "server-only";

import { setTimeout as delay } from "node:timers/promises";
import type { Connection, VersionedTransactionResponse } from "@solana/web3.js";

const DEFAULT_ATTEMPTS = 15;
const DEFAULT_DELAY_MS = 2_000;
const DEFAULT_MAX_DELAY_MS = 8_000;

function backoffDelay(baseMs: number, maxMs: number, attempt: number): number {
  const exponential = Math.min(maxMs, baseMs * 1.5 ** attempt);
  const jitter = 0.85 + Math.random() * 0.3;
  return Math.max(1, Math.round(exponential * jitter));
}

/**
 * Mainnet RPC nodes often return null from getTransaction briefly after confirmTransaction resolves.
 * Poll before telling the user their funds are lost. Solana web3.js does not expose AbortSignal
 * for these RPC methods, so cancellation is checked between calls and aborts every backoff delay.
 */
export async function fetchTransactionWithRetry(
  connection: Connection,
  signature: string,
  options?: { attempts?: number; delayMs?: number; maxDelayMs?: number; signal?: AbortSignal },
): Promise<VersionedTransactionResponse | null> {
  const attempts = options?.attempts ?? DEFAULT_ATTEMPTS;
  const delayMs = options?.delayMs ?? DEFAULT_DELAY_MS;
  const maxDelayMs = options?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const signal = options?.signal;

  for (let i = 0; i < attempts; i += 1) {
    signal?.throwIfAborted();
    const tx = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (tx) return tx;

    signal?.throwIfAborted();
    const statuses = await connection.getSignatureStatuses([signature]);
    const status = statuses.value[0];
    if (status?.err) return null;
    if (i >= attempts - 1) break;

    await delay(backoffDelay(delayMs, maxDelayMs, i), undefined, {
      signal,
      ref: false,
    });
  }
  return null;
}
