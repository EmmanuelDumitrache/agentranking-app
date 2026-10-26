-- Allow multiple AR cards per AppAccount (development + production).

DROP INDEX IF EXISTS "agent_kripicard_cards_app_account_id_key";

CREATE INDEX "agent_kripicard_cards_app_account_id_idx" ON "agent_kripicard_cards"("app_account_id");
