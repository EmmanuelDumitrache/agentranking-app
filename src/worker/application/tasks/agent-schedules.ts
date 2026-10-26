import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { enqueueApplicationJobsInTx } from "@/jobs/producer";
import { JOB_QUEUES } from "@/jobs/queues";
import { computeNextRunAt, isOnceCronExpr } from "@/lib/agent-schedule/cron";
import { executeAgentScheduleById } from "@/lib/agent-schedule/execute-run";

const SCAN_BATCH = 50;

function maxScheduleAttempts(): number {
  const raw = process.env.AGENT_SCHEDULE_MAX_ATTEMPTS?.trim();
  if (!raw) return 3;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? Math.min(10, Math.max(1, parsed)) : 3;
}

export async function agentScheduleScanJob(): Promise<{ enqueued: number }> {
  const now = new Date();
  const due = await prisma.agentSchedule.findMany({
    where: {
      status: "active",
      nextRunAt: { lte: now },
    },
    orderBy: [{ nextRunAt: "asc" }, { id: "asc" }],
    take: SCAN_BATCH,
    select: {
      id: true,
      cronExpr: true,
      nextRunAt: true,
    },
  });

  const onceSchedules = due.filter((schedule) => isOnceCronExpr(schedule.cronExpr));
  const existingOnceRuns = onceSchedules.length === 0
    ? []
    : await prisma.agentScheduleRun.findMany({
      where: {
        OR: onceSchedules.map((schedule) => ({
          scheduleId: schedule.id,
          scheduledFor: schedule.nextRunAt,
        })),
      },
      select: {
        scheduleId: true,
        scheduledFor: true,
        status: true,
        attempt: true,
      },
    });
  const onceRunsByOccurrence = new Map(
    existingOnceRuns.map((run) => [
      `${run.scheduleId}:${run.scheduledFor.toISOString()}`,
      run,
    ]),
  );
  const maximumAttempts = maxScheduleAttempts();
  const updates: Array<{
    id: string;
    expectedNextRunAt: Date;
    nextRunAt: Date;
    status: "active" | "paused";
    job: {
      data: { v: 1; scheduleId: string; scheduledFor: string };
      singletonKey: string;
    } | null;
  }> = [];

  for (const schedule of due) {
    const scheduledFor = schedule.nextRunAt;
    const isOnce = isOnceCronExpr(schedule.cronExpr);

    if (isOnce) {
      const existingRun = onceRunsByOccurrence.get(
        `${schedule.id}:${scheduledFor.toISOString()}`,
      );
      // Failed one-shot executions deliberately restore nextRunAt to the
      // original occurrence so the scanner can retry them. Success/skipped
      // (and an in-flight pending/running claim) remain terminal for scanning.
      if (existingRun && existingRun.status !== "failed") continue;
      if (existingRun?.status === "failed" && existingRun.attempt >= maximumAttempts) {
        updates.push({
          id: schedule.id,
          expectedNextRunAt: scheduledFor,
          nextRunAt: scheduledFor,
          status: "paused",
          job: null,
        });
        continue;
      }
    }

    const nextAfterClaim = isOnce
      ? new Date("2099-01-01T00:00:00.000Z")
      : computeNextRunAt(schedule.cronExpr, new Date(scheduledFor.getTime() + 1_000));
    const scheduledForIso = scheduledFor.toISOString();
    updates.push({
      id: schedule.id,
      expectedNextRunAt: scheduledFor,
      nextRunAt: nextAfterClaim,
      status: "active",
      job: {
        data: {
          v: 1,
          scheduleId: schedule.id,
          scheduledFor: scheduledForIso,
        },
        singletonKey: `${schedule.id}:${scheduledForIso}`,
      },
    });
  }
  if (updates.length === 0) return { enqueued: 0 };

  return prisma.$transaction(async (tx) => {
    const changed = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      UPDATE "agent_schedules" AS target SET
        "next_run_at" = incoming."next_run_at",
        "status" = incoming."status",
        "updated_at" = ${now}::timestamp(3)
      FROM (VALUES ${Prisma.join(updates.map((update) => Prisma.sql`(
        ${update.id}::text,
        ${update.expectedNextRunAt}::timestamp(3),
        ${update.nextRunAt}::timestamp(3),
        ${update.status}::text
      )`))}) AS incoming("id", "expected_next_run_at", "next_run_at", "status")
      WHERE target."id" = incoming."id"
        AND target."status" = 'active'
        AND target."next_run_at" = incoming."expected_next_run_at"
      RETURNING target."id"
    `);
    const changedIds = new Set(changed.map((row) => row.id));
    const jobs = updates.flatMap((update) =>
      changedIds.has(update.id) && update.job ? [update.job] : [],
    );
    await enqueueApplicationJobsInTx(
      tx,
      JOB_QUEUES.AGENT_SCHEDULE_EXECUTE,
      jobs,
      { returnIds: false },
    );
    return { enqueued: jobs.length };
  });
}

export async function agentScheduleExecuteJob(
  scheduleId: string,
  scheduledForIso: string,
): Promise<unknown> {
  const scheduledFor = new Date(scheduledForIso);
  return executeAgentScheduleById(scheduleId, scheduledFor);
}
