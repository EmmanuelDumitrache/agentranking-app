import { randomBytes } from "node:crypto";

/** Opaque public account identifier — no link to OAuth identity or PII. */
export function generateAccountPublicId(): string {
  return `AR-${randomBytes(6).toString("hex").toUpperCase()}`;
}
