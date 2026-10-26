import {
  ECOSYSTEM_SERIES_DAYS,
  type EcosystemSeriesPoint,
  type EcosystemTimeseries,
} from "@/lib/agent-directory/ecosystem-series";
import { prisma } from "@/lib/db";
type DailyRow = { day: Date; count: bigint | number };
function utcDayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function buildDayRange(days: number): string[] {
  const out: string[] = [];
  const cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);
  cursor.setUTCDate(cursor.getUTCDate() - (days - 1));
  for (let i = 0; i < days; i++) {
    out.push(utcDayKey(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}
function rowsToSeries(rows: DailyRow[], days: string[]): EcosystemSeriesPoint[] {
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(utcDayKey(new Date(row.day)), Number(row.count));
  }
  return days.map((date) => ({ date, value: map.get(date) ?? 0 }));
}
/**
 * Cumulative ecosystem counts at end of each UTC calendar day (gradual growth trend).
 * Headline totals are current; sparklines show how each metric grew day-by-day.
 */
export async function fetchEcosystemTimeseries(): Promise<EcosystemTimeseries> {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - (ECOSYSTEM_SERIES_DAYS - 1));
  const sinceDate = utcDayKey(since);
  const [totalRows, verifiedRows, x402Rows, mcpRows, feedbackRows, networkRows] = await Promise.all([
    prisma.$queryRaw<DailyRow[]>`
      WITH days AS (
        SELECT generate_series(
          ${sinceDate}::date,
          (timezone('UTC', now()))::date,
          interval '1 day'
        )::date AS day
      )
      SELECT
        d.day,
        (
          SELECT COUNT(*)::int
          FROM "Agent" a
          WHERE (a."createdAt" AT TIME ZONE 'UTC')::date <= d.day
        ) AS count
      FROM days d
      ORDER BY d.day
    `,
    prisma.$queryRaw<DailyRow[]>`
      WITH days AS (
        SELECT generate_series(
          ${sinceDate}::date,
          (timezone('UTC', now()))::date,
          interval '1 day'
        )::date AS day
      )
      SELECT
        d.day,
        (
          SELECT COUNT(*)::int
          FROM "Agent" a
          WHERE a."isActive" = true
            AND (a."isVerified" = true OR a."isPremiumVerified" = true)
            AND (a."createdAt" AT TIME ZONE 'UTC')::date <= d.day
        ) AS count
      FROM days d
      ORDER BY d.day
    `,
    prisma.$queryRaw<DailyRow[]>`
      WITH days AS (
        SELECT generate_series(
          ${sinceDate}::date,
          (timezone('UTC', now()))::date,
          interval '1 day'
        )::date AS day
      )
      SELECT
        d.day,
        (
          SELECT COUNT(*)::int
          FROM "Agent" a
          WHERE a."isActive" = true
            AND a."x402Support" = true
            AND (a."createdAt" AT TIME ZONE 'UTC')::date <= d.day
        ) AS count
      FROM days d
      ORDER BY d.day
    `,
    prisma.$queryRaw<DailyRow[]>`
      WITH days AS (
        SELECT generate_series(
          ${sinceDate}::date,
          (timezone('UTC', now()))::date,
          interval '1 day'
        )::date AS day
      )
      SELECT
        d.day,
        (
          SELECT COUNT(DISTINCT a.id)::int
          FROM "Agent" a
          INNER JOIN "AgentMetadata" m ON m."agentId" = a.id AND m.key = 'mcpTools'
          WHERE a."isActive" = true
            AND (a."createdAt" AT TIME ZONE 'UTC')::date <= d.day
        ) AS count
      FROM days d
      ORDER BY d.day
    `,
    prisma.$queryRaw<DailyRow[]>`
      WITH days AS (
        SELECT generate_series(
          ${sinceDate}::date,
          (timezone('UTC', now()))::date,
          interval '1 day'
        )::date AS day
      )
      SELECT
        d.day,
        (
          SELECT COUNT(*)::int
          FROM "Feedback" f
          WHERE (f."createdAt" AT TIME ZONE 'UTC')::date <= d.day
        ) AS count
      FROM days d
      ORDER BY d.day
    `,
    prisma.$queryRaw<DailyRow[]>`
      WITH days AS (
        SELECT generate_series(
          ${sinceDate}::date,
          (timezone('UTC', now()))::date,
          interval '1 day'
        )::date AS day
      )
      SELECT
        d.day,
        (
          SELECT COUNT(*)::int
          FROM "Chain" c
          WHERE c."isActive" = true
            AND EXISTS (
              SELECT 1
              FROM "Agent" a
              WHERE a."chainId" = c."chainId"
                AND a."isActive" = true
                AND (a."createdAt" AT TIME ZONE 'UTC')::date <= d.day
            )
        ) AS count
      FROM days d
      ORDER BY d.day
    `,
  ]);
  const days = buildDayRange(ECOSYSTEM_SERIES_DAYS);
  return {
    total: rowsToSeries(totalRows, days),
    verified: rowsToSeries(verifiedRows, days),
    mcp: rowsToSeries(mcpRows, days),
    x402: rowsToSeries(x402Rows, days),
    feedback: rowsToSeries(feedbackRows, days),
    networks: rowsToSeries(networkRows, days),
  };
}