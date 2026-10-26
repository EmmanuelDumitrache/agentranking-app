import { CronExpressionParser } from "cron-parser";
import type { AgentScheduleFrequency } from "./types";

const CRON_PARTS = 5;
export const ONCE_CRON_PREFIX = "@once:";

export function isOnceCronExpr(cronExpr: string): boolean {
  return cronExpr.startsWith(ONCE_CRON_PREFIX);
}

export function parseOnceRunAt(cronExpr: string): Date {
  const iso = cronExpr.slice(ONCE_CRON_PREFIX.length);
  const runAt = new Date(iso);
  if (Number.isNaN(runAt.getTime())) {
    throw new Error("Invalid one-time run time");
  }
  return runAt;
}

export function frequencyToCronExpr(frequency: AgentScheduleFrequency): string {
  switch (frequency.kind) {
    case "hourly":
      return `${clampMinute(frequency.minuteUtc)} * * * *`;
    case "daily":
      return `${clampMinute(frequency.minuteUtc)} ${clampHour(frequency.hourUtc)} * * *`;
    case "weekly":
      return `${clampMinute(frequency.minuteUtc)} ${clampHour(frequency.hourUtc)} * * ${clampDay(frequency.dayOfWeekUtc)}`;
    case "once": {
      const runAt = new Date(frequency.runAtUtc);
      if (Number.isNaN(runAt.getTime())) {
        throw new Error("Invalid one-time run time");
      }
      return `${ONCE_CRON_PREFIX}${runAt.toISOString()}`;
    }
    case "custom": {
      const expr = frequency.cronExpr.trim();
      if (!isValidCronExpr(expr)) {
        throw new Error("Invalid cron expression (5-field UTC cron required)");
      }
      return expr;
    }
    default: {
      const _exhaustive: never = frequency;
      return _exhaustive;
    }
  }
}

function formatClockTime(hour: string, minute: string): string {
  const h = Number.parseInt(hour, 10);
  const m = Number.parseInt(minute, 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return `${hour}:${minute}`;
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${minute.padStart(2, "0")} ${period}`;
}

export function cronExprToLabel(cronExpr: string): string {
  if (isOnceCronExpr(cronExpr)) {
    const runAt = parseOnceRunAt(cronExpr);
    return `Once on ${runAt.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    })} UTC`;
  }

  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== CRON_PARTS) return "Custom schedule";
  const [minute, hour, , , dayOfWeek] = parts;
  if (minute !== "*" && hour === "*" && dayOfWeek === "*") {
    return `Every hour at :${minute.padStart(2, "0")}`;
  }
  if (minute !== "*" && hour !== "*" && dayOfWeek === "*") {
    return `Every day at ${formatClockTime(hour, minute)}`;
  }
  if (minute !== "*" && hour !== "*" && dayOfWeek !== "*") {
    const days = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    const day = days[Number.parseInt(dayOfWeek, 10)] ?? dayOfWeek;
    return `Every ${day} at ${formatClockTime(hour, minute)}`;
  }
  return "Custom schedule";
}

export function computeNextRunAt(
  cronExpr: string,
  from: Date = new Date(),
): Date {
  if (isOnceCronExpr(cronExpr)) {
    return parseOnceRunAt(cronExpr);
  }

  const interval = CronExpressionParser.parse(cronExpr.trim(), {
    currentDate: from,
    tz: "UTC",
  });
  return interval.next().toDate();
}

export function isValidCronExpr(cronExpr: string): boolean {
  if (isOnceCronExpr(cronExpr)) {
    try {
      parseOnceRunAt(cronExpr);
      return true;
    } catch {
      return false;
    }
  }
  try {
    CronExpressionParser.parse(cronExpr.trim(), { tz: "UTC" });
    return cronExpr.trim().split(/\s+/).length === CRON_PARTS;
  } catch {
    return false;
  }
}

function clampMinute(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 59) {
    throw new Error("minuteUtc must be 0–59");
  }
  return value;
}

function clampHour(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 23) {
    throw new Error("hourUtc must be 0–23");
  }
  return value;
}

function clampDay(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 6) {
    throw new Error("dayOfWeekUtc must be 0–6 (Sun–Sat)");
  }
  return value;
}
