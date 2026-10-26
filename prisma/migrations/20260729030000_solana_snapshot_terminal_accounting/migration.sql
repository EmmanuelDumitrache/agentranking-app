-- Completed current-state Solana snapshots may contain deterministically
-- rejected source records. Those records are terminally accounted rather than
-- silently omitted, while transient failures still prevent completion.

ALTER TABLE public.solana_registry_snapshots
  DROP CONSTRAINT IF EXISTS solana_registry_snapshots_complete_coverage_check;

ALTER TABLE public.solana_registry_snapshots
  ADD CONSTRAINT solana_registry_snapshots_complete_coverage_check
  CHECK (
    status <> 'complete'::text
    OR (
      (reported_count IS NULL OR reported_count = discovered_count)
      AND (
        (
          source IN ('solana-8004'::text, 'metaplex-agent-registry'::text)
          AND indexed_count + rejected_count = discovered_count
          AND terminal_reject_count = rejected_count
        )
        OR (
          source NOT IN ('solana-8004'::text, 'metaplex-agent-registry'::text)
          AND rejected_count = 0
          AND terminal_reject_count = 0
          AND indexed_count = discovered_count
        )
      )
    )
  );
