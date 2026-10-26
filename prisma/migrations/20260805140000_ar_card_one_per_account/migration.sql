-- One AR card per AppAccount (shared by all agents).
-- Keep the newest non-cancelled card per account; cancel extras.

DELETE FROM "agent_kripicard_cards" a
USING "agent_kripicard_cards" b
WHERE a.app_account_id = b.app_account_id
  AND a.id <> b.id
  AND (
    a.created_at < b.created_at
    OR (a.created_at = b.created_at AND a.id < b.id)
  );

ALTER TABLE "agent_kripicard_cards" DROP CONSTRAINT IF EXISTS "agent_kripicard_cards_agent_id_key";
ALTER TABLE "agent_kripicard_cards" DROP CONSTRAINT IF EXISTS "agent_kripicard_cards_agent_id_fkey";

ALTER TABLE "agent_kripicard_cards" ALTER COLUMN "agent_id" DROP NOT NULL;

ALTER TABLE "agent_kripicard_cards"
  ADD CONSTRAINT "agent_kripicard_cards_agent_id_fkey"
  FOREIGN KEY ("agent_id") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP INDEX IF EXISTS "agent_kripicard_cards_app_account_id_idx";

CREATE UNIQUE INDEX "agent_kripicard_cards_app_account_id_key" ON "agent_kripicard_cards"("app_account_id");
CREATE INDEX "agent_kripicard_cards_agent_id_idx" ON "agent_kripicard_cards"("agent_id");
