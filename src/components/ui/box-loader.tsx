/** Zinc-themed creation loader — soft orbiting frames, AgentRanking palette. */
export function BoxLoader() {
  return (
    <output className="ar-loader" aria-label="Loading">
      <span className="ar-loader__orbit ar-loader__orbit--a" aria-hidden />
      <span className="ar-loader__orbit ar-loader__orbit--b" aria-hidden />
      <span className="ar-loader__core" aria-hidden>
        <span className="ar-loader__core-inner" />
      </span>
    </output>
  );
}
