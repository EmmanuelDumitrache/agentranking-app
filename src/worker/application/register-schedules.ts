import type { PgBoss } from "pg-boss";
import { JOB_QUEUES } from "../../jobs/queues";
const TZ = "Etc/UTC";
const KEY = "production";
const OWNED_PREFIXES = ["maint.", "partner.", "chat.", "subscription.", "launch.", "agent.schedule"] as const;
type ScheduleDefinition = { name: string; cron: string; data?: object };
function feeDistributionScheduleEnabled(): boolean {
  const raw = process.env.AGENT_LAUNCH_FEE_DISTRIBUTION_ENABLED?.trim().toLowerCase();
  return raw === "1" || raw === "true";
}
function applicationSchedules(): ScheduleDefinition[] {
  return [
    // Chat execution leases are only 10 seconds. Run the durable repair pass
    // every minute so a process crash cannot hold the one-active-run guard for
    // nearly five minutes before the reconciler gets a chance to release it.
    { name: JOB_QUEUES.CHAT_STALE_RUN_SCAN, cron: "* * * * *" },
    { name: JOB_QUEUES.MEMORY_OUTBOX_DISPATCH, cron: "* * * * *" },
    { name: JOB_QUEUES.AGENT_SCHEDULE_SCAN, cron: "* * * * *" },
    // Primary rank updates are mutation-driven; this daily pass is a repair backstop.
    { name: JOB_QUEUES.MAINT_RECOMPUTE_RANKS, cron: "15 3 * * *" },
    { name: JOB_QUEUES.MAINT_RANK_SNAPSHOT, cron: "0 0 * * *" },
    { name: JOB_QUEUES.MAINT_STALE_AGENT_SWEEP, cron: "30 2 * * *" },
    { name: JOB_QUEUES.MAINT_ROBINHOOD_PREPARATION_PRUNE, cron: "45 2 * * *" },
    { name: JOB_QUEUES.MAINT_PERF_SCAN, cron: "30 */6 * * *" },
    { name: JOB_QUEUES.MAINT_ACTIVITY_SCAN, cron: "10 */6 * * *" },
    { name: JOB_QUEUES.MAINT_STAKE_SYNC, cron: "*/30 * * * *" },
    { name: JOB_QUEUES.SUBSCRIPTION_NOTIFICATION_SCAN, cron: "0 10 * * *" },
    { name: JOB_QUEUES.PARTNER_JOBS_SCAN, cron: "*/15 * * * *" },
    { name: JOB_QUEUES.PARTNER_SAP_SYNC, cron: "0 */4 * * *" },
    { name: JOB_QUEUES.PARTNER_HATCHER_SYNC, cron: "30 */2 * * *" },
    { name: JOB_QUEUES.PARTNER_FAIRSCALE_SCAN, cron: "20 */6 * * *" },
    { name: JOB_QUEUES.PARTNER_INFERENCE_SCAN, cron: "10 */6 * * *" },
    { name: JOB_QUEUES.PARTNER_X402_DIRECTORY_REFRESH, cron: "*/15 * * * *" },
    { name: JOB_QUEUES.MAINT_ENDPOINT_SCAN, cron: "20 * * * *" },
    { name: JOB_QUEUES.MAINT_OPENROUTER_BALANCE_SNAPSHOT, cron: "*/15 * * * *" },
    { name: JOB_QUEUES.MAINT_MCP_CATALOG_REFRESH, cron: "17 * * * *" },
    ...(feeDistributionScheduleEnabled()
      ? [
          {
            name: JOB_QUEUES.LAUNCH_FEE_SCAN,
            cron: "*/15 * * * *",
            data: { v: 1, mode: "scheduled" },
          },
        ]
      : []),
  ];
}
export async function registerApplicationSchedules(boss: PgBoss): Promise<void> {
  const schedules = applicationSchedules();
  const wanted = new Set(schedules.map((schedule) => schedule.name));
  const existing = await boss.getSchedules();
  await Promise.all([
    ...schedules.map((schedule) =>
      boss.schedule(
        schedule.name,
        schedule.cron,
        schedule.data ?? { v: 1 },
        { key: KEY, tz: TZ },
      )
    ),
    ...existing
      .filter((schedule) => schedule.key === KEY && OWNED_PREFIXES.some((prefix) => schedule.name.startsWith(prefix)))
      .filter((schedule) => !wanted.has(schedule.name))
      .map((schedule) => boss.unschedule(schedule.name, schedule.key)),
  ]);
}
