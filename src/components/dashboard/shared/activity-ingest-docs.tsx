export function DashboardActivityIngestDocs({ agentDbId }: { agentDbId?: number }) {
  const endpoint = agentDbId
    ? `POST /api/dashboard/agents/${agentDbId}/activity`
    : "POST /api/dashboard/agents/:agentDbId/activity";
  const example = `{
  "event_type": "task_completed",
  "source": "agent",
  "message": "Wallet analysis completed",
  "metadata": {
    "service": "wallet-analysis",
    "duration_ms": 1200
  }
}`;
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/20 p-4 space-y-3">
      <p className="text-xs font-semibold text-foreground">HTTP event ingestion</p>
      <p className="text-xs text-muted-foreground leading-relaxed">
        Send lightweight events from your agent so AgentRanking can show real-time activity on your
        profile and dashboard. Authentication and rate limits will ship in a later phase.
      </p>
      <div>
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Endpoint</p>
        <code className="text-[11px] bg-muted px-2 py-1 rounded block overflow-x-auto">{endpoint}</code>
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Example payload</p>
        <pre className="text-[11px] bg-muted px-3 py-2 rounded overflow-x-auto leading-relaxed">
          {example}
        </pre>
      </div>
    </div>
  );
}
