/**
 * Emergency brake for pause-aware application job handlers and manual job routes.
 *
 * Set `PAUSE_BACKGROUND_JOBS=1` on the VPS `.env`, sync env, and restart both PM2 processes.
 * For a hard database incident, `pm2 stop agentranking-worker`; pg-boss schedules remain durable in PostgreSQL.
 */
export function isBackgroundJobsPaused(): boolean {
  const raw = process.env.PAUSE_BACKGROUND_JOBS?.trim() ?? "";
  if (!raw) return false;
  const lower = raw.toLowerCase();
  return raw === "1" || lower === "true" || lower === "yes" || lower === "on";
}

export function backgroundJobsPausedResponse(): Response {
  return Response.json(
    {
      ok: false,
      paused: true,
      code: "BACKGROUND_JOBS_PAUSED",
      message:
        "Background jobs are paused (PAUSE_BACKGROUND_JOBS). No database work was performed. Unset PAUSE_BACKGROUND_JOBS, sync env, and restart agentranking + agentranking-worker to resume.",
    },
    {
      status: 503,
      headers: {
        "Retry-After": "3600",
        "Cache-Control": "no-store",
      },
    },
  );
}
