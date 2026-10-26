import { fromPrisma, type JobInsert, type SendOptions } from "pg-boss";
import type { Prisma } from "@/generated/prisma/client";
import { getJobProducer } from "./boss";
import { JOB_QUEUES, type ApplicationQueueName } from "./queues";

const APPLICATION_JOB_INSERT_BATCH_SIZE = 500;
type ApplicationBatchInsertOptions = { returnIds?: boolean };

export async function enqueueApplicationJob(
  name: ApplicationQueueName,
  data: object = { v: 1 },
  options: SendOptions = {},
): Promise<string | null> {
  const boss = await getJobProducer();
  return boss.send(name, data, options);
}

export async function enqueueApplicationJobs<T extends object>(
  name: ApplicationQueueName,
  jobs: readonly JobInsert<T>[],
  options: ApplicationBatchInsertOptions = {},
): Promise<string[]> {
  if (jobs.length === 0) return [];
  const boss = await getJobProducer();
  const insertedIds: string[] = [];
  for (let offset = 0; offset < jobs.length; offset += APPLICATION_JOB_INSERT_BATCH_SIZE) {
    const ids = await boss.insert(
      name,
      jobs.slice(offset, offset + APPLICATION_JOB_INSERT_BATCH_SIZE),
      { returnId: options.returnIds !== false },
    );
    if (ids) insertedIds.push(...ids);
  }
  return insertedIds;
}

export async function enqueueApplicationJobInTx(
  tx: Prisma.TransactionClient,
  name: ApplicationQueueName,
  data: object = { v: 1 },
  options: SendOptions = {},
): Promise<string | null> {
  const boss = await getJobProducer();
  return boss.send(name, data, { ...options, db: fromPrisma(tx) });
}

export async function enqueueApplicationJobsInTx<T extends object>(
  tx: Prisma.TransactionClient,
  name: ApplicationQueueName,
  jobs: readonly JobInsert<T>[],
  options: ApplicationBatchInsertOptions = {},
): Promise<string[]> {
  if (jobs.length === 0) return [];
  const boss = await getJobProducer();
  const insertedIds: string[] = [];
  const db = fromPrisma(tx);
  for (let offset = 0; offset < jobs.length; offset += APPLICATION_JOB_INSERT_BATCH_SIZE) {
    const ids = await boss.insert(
      name,
      jobs.slice(offset, offset + APPLICATION_JOB_INSERT_BATCH_SIZE),
      { returnId: options.returnIds !== false, db },
    );
    if (ids) insertedIds.push(...ids);
  }
  return insertedIds;
}

export async function enqueueAgentSignalSync(agentId: number): Promise<string | null> {
  const boss = await getJobProducer();
  return boss.sendDebounced(JOB_QUEUES.AGENT_SIGNALS_SYNC, { v: 1, id: agentId }, null, 30, String(agentId));
}
