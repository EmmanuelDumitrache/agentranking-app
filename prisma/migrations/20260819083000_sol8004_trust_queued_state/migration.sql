BEGIN;

ALTER TABLE "solana_8004_trust_signatures"
  DROP CONSTRAINT IF EXISTS "solana_8004_trust_signatures_status_check";

ALTER TABLE "solana_8004_trust_signatures"
  ADD CONSTRAINT "solana_8004_trust_signatures_status_check"
  CHECK (
    "status" = ANY (
      ARRAY[
        'PENDING'::text,
        'QUEUED'::text,
        'RUNNING'::text,
        'COMPLETE'::text,
        'NO_TRUST'::text,
        'PRUNED'::text,
        'FAILED'::text
      ]
    )
  );

COMMIT;
