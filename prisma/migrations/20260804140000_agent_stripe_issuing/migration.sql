-- Agent Stripe Issuing (fiat balance, per-agent virtual cards)

CREATE TYPE "AgentIssuingCardStatus" AS ENUM ('PENDING', 'ACTIVE', 'FROZEN', 'CANCELLED');

CREATE TABLE "agent_issuing_cards" (
    "id" TEXT NOT NULL,
    "agent_id" INTEGER NOT NULL,
    "app_account_id" TEXT NOT NULL,
    "stripe_cardholder_id" TEXT NOT NULL,
    "stripe_card_id" TEXT NOT NULL,
    "provider_name" TEXT NOT NULL DEFAULT 'stripe-issuing-standard',
    "last_four" TEXT NOT NULL,
    "brand" TEXT NOT NULL DEFAULT 'visa',
    "status" "AgentIssuingCardStatus" NOT NULL DEFAULT 'ACTIVE',
    "risk_tier" TEXT NOT NULL,
    "daily_limit_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_issuing_cards_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_issuing_authorizations" (
    "id" TEXT NOT NULL,
    "agent_issuing_card_id" TEXT NOT NULL,
    "stripe_authorization_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "approved" BOOLEAN NOT NULL,
    "decline_reason" TEXT,
    "merchant_name" TEXT,
    "event_type" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_issuing_authorizations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agent_issuing_cards_agent_id_key" ON "agent_issuing_cards"("agent_id");
CREATE UNIQUE INDEX "agent_issuing_cards_stripe_cardholder_id_key" ON "agent_issuing_cards"("stripe_cardholder_id");
CREATE UNIQUE INDEX "agent_issuing_cards_stripe_card_id_key" ON "agent_issuing_cards"("stripe_card_id");
CREATE INDEX "agent_issuing_cards_app_account_id_idx" ON "agent_issuing_cards"("app_account_id");
CREATE INDEX "agent_issuing_cards_status_idx" ON "agent_issuing_cards"("status");

CREATE UNIQUE INDEX "agent_issuing_authorizations_stripe_authorization_id_key" ON "agent_issuing_authorizations"("stripe_authorization_id");
CREATE INDEX "agent_issuing_authorizations_agent_issuing_card_id_created_at_idx" ON "agent_issuing_authorizations"("agent_issuing_card_id", "created_at");

ALTER TABLE "agent_issuing_cards" ADD CONSTRAINT "agent_issuing_cards_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_issuing_cards" ADD CONSTRAINT "agent_issuing_cards_app_account_id_fkey" FOREIGN KEY ("app_account_id") REFERENCES "app_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_issuing_authorizations" ADD CONSTRAINT "agent_issuing_authorizations_agent_issuing_card_id_fkey" FOREIGN KEY ("agent_issuing_card_id") REFERENCES "agent_issuing_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
