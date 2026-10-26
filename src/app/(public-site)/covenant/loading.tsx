export default function CovenantDashboardLoading() {
  return (
    <div className="mx-auto w-full max-w-7xl animate-pulse space-y-4 px-4 py-4 md:px-6 md:py-6">
      <div className="h-32 rounded-xl border border-teal-500/20 bg-card/40" />
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 rounded-lg border border-border/50 bg-card/30" />
        ))}
      </div>
      <div className="h-64 rounded-xl border border-border/50 bg-card/30" />
    </div>
  );
}
