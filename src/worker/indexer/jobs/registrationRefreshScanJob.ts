import { prisma } from "../db.js";
import { parseOptionalStrictUnsignedInteger } from "../lib/strict-integer.js";
import { SOLANA_CHAIN_ID } from "../chain-constants.js";
import { enqueueAgentMetadataHydrationBatch, enqueueSolanaMetadataHydrationBatch } from "../queue/producer.js";
const SOURCE_KEY = "maintenance:mutable-registration-refresh";
type Cursor = { v: 1; lastId: number };
function parseCursor(value: string | null | undefined): Cursor {
  if (!value) return { v: 1, lastId: 0 };
  try {
    const parsed = JSON.parse(value) as Partial<Cursor>;
    return parsed.v === 1 && Number.isSafeInteger(parsed.lastId) && (parsed.lastId ?? -1) >= 0
      ? { v: 1, lastId: parsed.lastId! }
      : { v: 1, lastId: 0 };
  } catch {
    return { v: 1, lastId: 0 };
  }
}
export async function runRegistrationRefreshScan(): Promise<{ enqueued: number; complete: boolean; nextId: number }> {
  const batchSize = parseOptionalStrictUnsignedInteger(
    process.env.WORKER_REGISTRATION_REFRESH_BATCH,
    "WORKER_REGISTRATION_REFRESH_BATCH",
    200,
    { maximum: 5_000 },
  );
  const refreshMs = parseOptionalStrictUnsignedInteger(
    process.env.WORKER_MUTABLE_REGISTRATION_REFRESH_SECONDS,
    "WORKER_MUTABLE_REGISTRATION_REFRESH_SECONDS",
    60 * 60,
    { maximum: 30 * 24 * 60 * 60 },
  ) * 1_000;
  const cursorRow = await prisma.indexerSourceCursor.findUnique({ where: { sourceKey: SOURCE_KEY } });
  const cursor = parseCursor(cursorRow?.opaqueCursor);
  const now = new Date();
  const staleBefore = new Date(now.getTime() - refreshMs);
  const rows = await prisma.agent.findMany({
    where: {
      id: { gt: cursor.lastId },
      registrationNormalizedUri: { startsWith: "https://" },
      sourceActive: { not: false },
      // Metaplex-only Solana agents are refreshed by the snapshot indexer and
      // have no direct-registry asset for the hydration queue to address.
      OR: [
        { chainId: { not: SOLANA_CHAIN_ID } },
        { solanaAssetAddress: { not: null } },
      ],
      AND: [
        {
          OR: [
            { registrationStatus: null },
            { registrationStatus: { not: "permanent_invalid" } },
          ],
        },
        {
          OR: [
            { registrationNextRetryAt: { lte: now } },
            {
              registrationNextRetryAt: null,
              OR: [
                { registrationLastSuccessAt: null },
                { registrationLastSuccessAt: { lt: staleBefore } },
              ],
            },
          ],
        },
      ],
    },
    orderBy: { id: "asc" },
    take: batchSize,
    select: { id: true, chainId: true, protocolAgentId: true, agentId: true, agentURI: true, solanaAssetAddress: true },
  });
  const evmPayloads = rows
    .filter((row) => row.chainId !== SOLANA_CHAIN_ID && row.agentURI.startsWith("https://"))
    .map((row) => ({
      chainId: row.chainId,
      agentId: row.protocolAgentId ?? String(row.agentId),
      uri: row.agentURI,
    }));
  const solanaPayloads = rows
    .filter((row) => row.chainId === SOLANA_CHAIN_ID && row.solanaAssetAddress && row.agentURI.startsWith("https://"))
    .map((row) => ({ asset: row.solanaAssetAddress!, uri: row.agentURI }));
  const enqueueResults = await Promise.allSettled([
    enqueueAgentMetadataHydrationBatch(evmPayloads),
    enqueueSolanaMetadataHydrationBatch(solanaPayloads),
  ]);
  const enqueueFailures = enqueueResults.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  if (enqueueFailures.length === 1) throw enqueueFailures[0].reason;
  if (enqueueFailures.length > 1) {
    throw new AggregateError(enqueueFailures.map((failure) => failure.reason), "registration refresh enqueue failed");
  }
  const evmEnqueued = (enqueueResults[0] as PromiseFulfilledResult<number>).value;
  const solanaEnqueued = (enqueueResults[1] as PromiseFulfilledResult<number>).value;
  const enqueued = evmEnqueued + solanaEnqueued;
  const complete = rows.length < batchSize;
  const nextId = complete ? 0 : rows.at(-1)!.id;
  await prisma.indexerSourceCursor.upsert({
    where: { sourceKey: SOURCE_KEY },
    create: {
      sourceKey: SOURCE_KEY,
      domain: "registration-refresh",
      opaqueCursor: JSON.stringify({ v: 1, lastId: nextId } satisfies Cursor),
      lastAdvancedAt: now,
      reconciliationGeneration: complete ? 1n : 0n,
    },
    update: {
      opaqueCursor: JSON.stringify({ v: 1, lastId: nextId } satisfies Cursor),
      lastAdvancedAt: now,
      ...(complete ? { reconciliationGeneration: { increment: 1n } } : {}),
    },
  });
  return { enqueued, complete, nextId };
}
