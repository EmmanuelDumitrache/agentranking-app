export default function HatcherLoading() {
  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 px-4 py-4 md:px-6 md:py-6 animate-pulse">
      <div className="h-32 rounded-xl bg-muted/40 border border-emerald-500/20" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {["a", "b", "c", "d", "e"].map((k) => (
          <div key={k} className="h-20 rounded-lg bg-muted/30" />
        ))}
      </div>
      <div className="h-9 max-w-md rounded-md bg-muted/30" />
      <div className="h-64 rounded-lg bg-muted/20 border border-border/40" />
    </div>
  );
}
