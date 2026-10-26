-- Marqeta per-agent users/cards + JIT authorization audit

CREATE TABLE "agent_marqeta_cards" (
    "id" TEXT NOT NULL,
    "agent_id" INTEGER NOT NULL,
    "app_account_id" TEXT NOT NULL,
    "marqeta_user_token" TEXT NOT NULL,
    "marqeta_card_token" TEXT NOT NULL,
    "card_product_token" TEXT NOT NULL,
    "provider_name" TEXT NOT NULL DEFAULT 'marqeta',
    "last_four" TEXT NOT NULL,
    "brand" TEXT NOT NULL DEFAULT 'visa',
    "status" "AgentIssuingCardStatus" NOT NULL DEFAULT 'ACTIVE',
    "risk_tier" TEXT NOT NULL,
    "daily_limit_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_marqeta_cards_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_marqeta_authorizations" (
    "id" TEXT NOT NULL,
    "agent_marqeta_card_id" TEXT NOT NULL,
    "marqeta_jit_funding_token" TEXT NOT NULL,
    "marqeta_transaction_token" TEXT,
    "jit_method" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "approved" BOOLEAN NOT NULL,
    "decline_reason" TEXT,
    "merchant_name" TEXT,
    "merchant_category_code" TEXT,
    "balance_after_cents" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_marqeta_authorizations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agent_marqeta_cards_agent_id_key" ON "agent_marqeta_cards"("agent_id");
CREATE UNIQUE INDEX "agent_marqeta_cards_marqeta_user_token_key" ON "agent_marqeta_cards"("marqeta_user_token");
CREATE UNIQUE INDEX "agent_marqeta_cards_marqeta_card_token_key" ON "agent_marqeta_cards"("marqeta_card_token");
CREATE INDEX "agent_marqeta_cards_app_account_id_idx" ON "agent_marqeta_cards"("app_account_id");
CREATE INDEX "agent_marqeta_cards_status_idx" ON "agent_marqeta_cards"("status");

CREATE UNIQUE INDEX "agent_marqeta_authorizations_marqeta_jit_funding_token_key" ON "agent_marqeta_authorizations"("marqeta_jit_funding_token");
CREATE INDEX "agent_marqeta_authorizations_agent_marqeta_card_id_created_at_idx" ON "agent_marqeta_authorizations"("agent_marqeta_card_id", "created_at");

ALTER TABLE "agent_marqeta_cards" ADD CONSTRAINT "agent_marqeta_cards_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_marqeta_cards" ADD CONSTRAINT "agent_marqeta_cards_app_account_id_fkey" FOREIGN KEY ("app_account_id") REFERENCES "app_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_marqeta_authorizations" ADD CONSTRAINT "agent_marqeta_authorizations_agent_marqeta_card_id_fkey" FOREIGN KEY ("agent_marqeta_card_id") REFERENCES "agent_marqeta_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
