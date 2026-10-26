import "server-only";
import pRetry from "p-retry";

function isPoolSaturationMessage(message: string): boolean {
  return /max client connections reached|too many connections|remaining connection slots are reserved/i.test(message);
}

function isPoolCheckoutTimeoutMessage(message: string): boolean {
  return (
    /Unable to check out connection from the pool/i.test(message) ||
    /Timed out fetching a new connection from the pool/i.test(message) ||
    /waited too long to acquire a connection/i.test(message)
  );
}

export function isTransientPoolRetryMessage(message: string): boolean {
  return isPoolSaturationMessage(message) || isPoolCheckoutTimeoutMessage(message);
}

/** Retry only failures known to occur before a query obtains a PostgreSQL connection. */
export async function withTransientPoolRetry<T>(run: () => Promise<T>): Promise<T> {
  return pRetry(run, {
    retries: 2,
    factor: 2,
    minTimeout: 500,
    maxTimeout: 2_000,
    randomize: true,
    unref: true,
    shouldRetry: ({ error }) => isTransientPoolRetryMessage(error.message),
  });
}
