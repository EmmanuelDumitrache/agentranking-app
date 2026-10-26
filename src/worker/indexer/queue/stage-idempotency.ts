import { createHash } from "node:crypto";
import { prisma } from "../db.js";
function digest(encodedValue: string): string {
  return createHash("sha256").update(encodedValue).digest("hex");
}
export async function runIdempotentStage<T>(input: {
  businessKey: string;
  stage: string;
  sourceObservationKey?: string;
  operation: () => Promise<T>;
  shouldCache?: (result: T) => boolean;
}): Promise<T> {
  const key = `stage:${input.stage}:${input.businessKey}`;
  const existing = await prisma.indexerIdempotencyRecord.findUnique({
    where: { businessKey: key },
    select: { result: true },
  });
  if (existing?.result != null) return existing.result as T;
  const result = await input.operation();
  if (input.shouldCache && !input.shouldCache(result)) return result;
  const encodedResult = JSON.stringify(result);
  if (encodedResult === undefined) throw new TypeError("Idempotent stage result must be JSON-serializable");
  const serializable = JSON.parse(encodedResult) as T;
  const jsonResult = serializable as never;
  try {
    await prisma.indexerIdempotencyRecord.create({
      data: {
        businessKey: key,
        stage: input.stage,
        sourceObservationKey: input.sourceObservationKey,
        resultDigest: digest(encodedResult),
        result: jsonResult,
      },
    });
  } catch (error) {
    const winner = await prisma.indexerIdempotencyRecord.findUnique({
      where: { businessKey: key },
      select: { result: true },
    });
    if (winner?.result != null) return winner.result as T;
    throw error;
  }
  return serializable;
}
