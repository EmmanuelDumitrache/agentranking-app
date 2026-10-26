-- Agent stablecoin ledger + Lithic virtual cards (ASA JIT spend)

CREATE TYPE "AgentStablecoinLedgerEntryType" AS ENUM ('CREDIT', 'DEBIT', 'ADJUSTMENT');

CREATE TABLE "agent_stablecoin_ledgers" (
    "id" TEXT NOT NULL,
    "agent_id" INTEGER NOT NULL,
    "balance_usdc_cents" INTEGER NOT NULL DEFAULT 0,
    "reserved_usdc_cents" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_stablecoin_ledgers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_stablecoin_ledger_entries" (
    "id" TEXT NOT NULL,
    "ledger_id" TEXT NOT NULL,
    "type" "AgentStablecoinLedgerEntryType" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "balance_after_cents" INTEGER NOT NULL,
    "reference_type" TEXT,
    "reference_id" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_stablecoin_ledger_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_lithic_cards" (
    "id" TEXT NOT NULL,
    "agent_id" INTEGER NOT NULL,
    "app_account_id" TEXT NOT NULL,
    "lithic_card_token" TEXT NOT NULL,
    "provider_name" TEXT NOT NULL DEFAULT 'lithic',
    "last_four" TEXT NOT NULL,
    "brand" TEXT NOT NULL DEFAULT 'mastercard',
    "status" "AgentIssuingCardStatus" NOT NULL DEFAULT 'ACTIVE',
    "risk_tier" TEXT NOT NULL,
    "daily_limit_cents" INTEGER NOT NULL,
    "memo" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_lithic_cards_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_lithic_authorizations" (
    "id" TEXT NOT NULL,
    "agent_lithic_card_id" TEXT NOT NULL,
    "lithic_authorization_token" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "approved" BOOLEAN NOT NULL,
    "asa_result" TEXT NOT NULL,
    "decline_reason" TEXT,
    "merchant_name" TEXT,
    "merchant_category_code" TEXT,
    "balance_after_cents" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_lithic_authorizations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agent_stablecoin_ledgers_agent_id_key" ON "agent_stablecoin_ledgers"("agent_id");

CREATE INDEX "agent_stablecoin_ledger_entries_ledger_id_created_at_idx" ON "agent_stablecoin_ledger_entries"("ledger_id", "created_at");
CREATE INDEX "agent_stablecoin_ledger_entries_reference_type_reference_id_idx" ON "agent_stablecoin_ledger_entries"("reference_type", "reference_id");

CREATE UNIQUE INDEX "agent_lithic_cards_agent_id_key" ON "agent_lithic_cards"("agent_id");
CREATE UNIQUE INDEX "agent_lithic_cards_lithic_card_token_key" ON "agent_lithic_cards"("lithic_card_token");
CREATE INDEX "agent_lithic_cards_app_account_id_idx" ON "agent_lithic_cards"("app_account_id");
CREATE INDEX "agent_lithic_cards_status_idx" ON "agent_lithic_cards"("status");

CREATE UNIQUE INDEX "agent_lithic_authorizations_lithic_authorization_token_key" ON "agent_lithic_authorizations"("lithic_authorization_token");
CREATE INDEX "agent_lithic_authorizations_agent_lithic_card_id_created_at_idx" ON "agent_lithic_authorizations"("agent_lithic_card_id", "created_at");

ALTER TABLE "agent_stablecoin_ledgers" ADD CONSTRAINT "agent_stablecoin_ledgers_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_stablecoin_ledger_entries" ADD CONSTRAINT "agent_stablecoin_ledger_entries_ledger_id_fkey" FOREIGN KEY ("ledger_id") REFERENCES "agent_stablecoin_ledgers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_lithic_cards" ADD CONSTRAINT "agent_lithic_cards_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_lithic_cards" ADD CONSTRAINT "agent_lithic_cards_app_account_id_fkey" FOREIGN KEY ("app_account_id") REFERENCES "app_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_lithic_authorizations" ADD CONSTRAINT "agent_lithic_authorizations_agent_lithic_card_id_fkey" FOREIGN KEY ("agent_lithic_card_id") REFERENCES "agent_lithic_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
