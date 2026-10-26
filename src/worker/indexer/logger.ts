import { boundedLogJson } from "./lib/bounded-log-value.js";
import { boundUtf8String } from "./lib/unicode-bounds.js";
type LogLevel = "info" | "warn" | "error";
const LOG_FORMAT =
  process.env.LOG_FORMAT ?? (process.env.NODE_ENV === "production" ? "json" : "pretty");
const LOG_LEVEL = process.env.LOG_LEVEL ?? "info";
// ANSI escape codes for pretty logs (no new deps)
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[90m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
function levelStyle(level: LogLevel): string {
  switch (level) {
    case "info": return `${BOLD}${GREEN}`;
    case "warn": return `${BOLD}${YELLOW}`;
    case "error": return `${BOLD}${RED}`;
    default: return BOLD;
  }
}
const LEVEL_ORDER: Record<LogLevel, number> = { info: 0, warn: 1, error: 2 };
function shouldLog(level: LogLevel): boolean {
  const min = LEVEL_ORDER[LOG_LEVEL as LogLevel] ?? 0;
  return LEVEL_ORDER[level] >= min;
}
function prettyData(data: unknown): string {
  if (data === undefined || data === null) return "";
  if (typeof data !== "object") return String(data);
  const obj = data as Record<string, unknown>;
  return Object.entries(obj)
    .map(([k, v]) => {
      if (v === undefined) return "";
      const s = typeof v === "object" && v !== null ? boundedLogJson(v, 1_000) : String(v);
      const source = s.isWellFormed() ? s : s.toWellFormed();
      const bounded = boundUtf8String(source, 200, "pretty log value");
      return `${k}=${bounded.value}${bounded.truncated ? "…" : ""}`;
    })
    .filter(Boolean)
    .join(" ");
}
function write(level: LogLevel, message: string, data?: unknown, component?: string): void {
  if (!shouldLog(level)) return;
  const ts = new Date().toISOString();
  if (LOG_FORMAT === "pretty") {
    let payload = data;
    if (level === "error" && data !== undefined && typeof data === "object" && data !== null && "stack" in data) {
      const raw = data as Record<string, unknown>;
      const stack = raw.stack;
      if (typeof stack === "string" && stack.includes("\n")) {
        const trimmed = stack.split("\n").slice(0, 3).join("\n");
        payload = { ...raw, stack: trimmed };
      }
    }
    const tsDim = `${DIM}${ts}${RESET}`;
    const levelColored = `${levelStyle(level)}${level.toUpperCase().padEnd(5)}${RESET}`;
    const comp = component ? ` ${BOLD}${CYAN}[${component}]${RESET} ` : " ";
    const msgBold = `${BOLD}${message}${RESET}`;
    const dataStr = prettyData(payload);
    const line = dataStr ? `${tsDim}  ${levelColored}${comp}${msgBold}  ${dataStr}` : `${tsDim}  ${levelColored}${comp}${msgBold}`;
    console.log(line);
    return;
  }
  const base: Record<string, unknown> = { ts, level, message };
  if (component) base.component = component;
  if (data !== undefined) base.data = data;
  console.log(boundedLogJson(base));
}
export const logger = {
  info: (message: string, data?: unknown, component?: string) => write("info", message, data, component),
  warn: (message: string, data?: unknown, component?: string) => write("warn", message, data, component),
  error: (message: string, data?: unknown, component?: string) => write("error", message, data, component),
};
