import { NextResponse } from "next/server";
const ALERT_STORAGE_NAMES = [
  "AgentAlertRule",
  "AgentAlertEvent",
  "AgentAlertDelivery",
  "agent_alert_events",
  "agent_alert_deliveries",
] as const;
/** When one of the Agent Alert storage migrations has not been applied yet. */
export function agentAlertMigrationResponse(err: unknown): NextResponse | null {
  const msg = Error.isError(err) ? err.message : String(err);
  if (!ALERT_STORAGE_NAMES.some((name) => msg.includes(name))) return null;
  if (!msg.includes("does not exist") && !msg.toLowerCase().includes("relation")) return null;
  return NextResponse.json(
    {
      error:
        "Bot Alerts storage is not ready on this environment yet. Run database migrations (e.g. prisma migrate deploy), then reload.",
      code: "MIGRATION_REQUIRED",
    },
    { status: 503 },
  );
}