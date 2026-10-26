-- Remove a superseded integer balance column. The application exclusively uses
-- app_accounts.llm_balance_cents and the ledger-backed LLM credit flow.
ALTER TABLE "app_accounts" DROP COLUMN IF EXISTS "llm_credits";

-- These inherited tables predate the packed migration history. The application
-- uses the relations below and production has no orphaned rows, so restore the
-- referential guarantees declared by the Prisma data model.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.auth_accounts'::regclass
      AND conname = 'auth_accounts_userId_fkey'
  ) THEN
    ALTER TABLE "auth_accounts"
      ADD CONSTRAINT "auth_accounts_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "auth_users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.auth_sessions'::regclass
      AND conname = 'auth_sessions_userId_fkey'
  ) THEN
    ALTER TABLE "auth_sessions"
      ADD CONSTRAINT "auth_sessions_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "auth_users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public."DaoLeaderboardLive"'::regclass
      AND conname = 'DaoLeaderboardLive_agentId_fkey'
  ) THEN
    ALTER TABLE "DaoLeaderboardLive"
      ADD CONSTRAINT "DaoLeaderboardLive_agentId_fkey"
      FOREIGN KEY ("agentId") REFERENCES "Agent"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public."ContactInquiry"'::regclass
      AND conname = 'ContactInquiry_userId_fkey'
  ) THEN
    ALTER TABLE "ContactInquiry"
      ADD CONSTRAINT "ContactInquiry_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "UserProfile"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

-- Checkout identifiers are generated and subsequently used as stable public
-- references. Production was checked for duplicates before adding uniqueness.
CREATE UNIQUE INDEX IF NOT EXISTS "AdOrderSquare_orderNumber_key"
  ON "AdOrderSquare" ("orderNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "AdOrderStrip_orderNumber_key"
  ON "AdOrderStrip" ("orderNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "AgentBoost_orderNumber_key"
  ON "AgentBoost" ("orderNumber");

-- Match active-ad and wallet lookup paths used by the application.
CREATE INDEX IF NOT EXISTS "AdOrderSquare_status_expiresAt_idx"
  ON "AdOrderSquare" ("status", "expiresAt");
CREATE INDEX IF NOT EXISTS "AdOrderStrip_status_expiresAt_idx"
  ON "AdOrderStrip" ("status", "expiresAt");
CREATE INDEX IF NOT EXISTS "AgentBoost_wallet_idx"
  ON "AgentBoost" ("wallet");

-- Snapshot reads filter and order on these fields; the inherited tables were
-- missing the indexes declared by the live DAO code path.
CREATE INDEX IF NOT EXISTS "DaoLeaderboardSnapshot_capturedAt_idx"
  ON "DaoLeaderboardSnapshot" ("capturedAt");
CREATE INDEX IF NOT EXISTS "DaoLeaderboardSnapshot_periodKey_capturedAt_idx"
  ON "DaoLeaderboardSnapshot" ("periodKey", "capturedAt");
CREATE INDEX IF NOT EXISTS "DaoLeaderboardSnapshot_agentId_capturedAt_idx"
  ON "DaoLeaderboardSnapshot" ("agentId", "capturedAt");
