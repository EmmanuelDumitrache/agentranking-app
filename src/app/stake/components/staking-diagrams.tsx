export function StakingDiagrams() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="ar-public-glass rounded-xl p-4 sm:p-5">
        <p className="ar-public-label mb-3">Buyback flow</p>
        <div className="flex flex-col items-center gap-1 text-[11px] text-[var(--ar-text-secondary)]">
          {["Platform fees", "Buybacks", "Reward pools", "Stakers"].map((node, i, arr) => (
            <div key={node} className="flex w-full flex-col items-center">
              <div
                className={
                  i === arr.length - 1
                    ? "w-full rounded-[var(--ar-radius)] border border-[color-mix(in_oklab,var(--ar-success)_30%,transparent)] bg-[color-mix(in_oklab,var(--ar-success)_6%,transparent)] px-3 py-2 text-center"
                    : "w-full rounded-[var(--ar-radius)] border border-[var(--ar-border)] px-3 py-2 text-center"
                }
              >
                {node}
              </div>
              {i < arr.length - 1 ? <span className="my-0.5 text-[var(--ar-text-muted)]">↓</span> : null}
            </div>
          ))}
        </div>
      </div>
      <div className="ar-public-glass rounded-xl p-4 sm:p-5">
        <p className="ar-public-label mb-3">Stake lifecycle</p>
        <div className="flex flex-col items-center gap-1 text-[11px] text-[var(--ar-text-secondary)]">
          {["Stake $AR", "Receipt token", "Rewards accrue", "Claim / Unstake"].map((node, i, arr) => (
            <div key={node} className="flex w-full flex-col items-center">
              <div className="w-full rounded-[var(--ar-radius)] border border-[var(--ar-border)] px-3 py-2 text-center">
                {node}
              </div>
              {i < arr.length - 1 ? <span className="my-0.5 text-[var(--ar-text-muted)]">↓</span> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
