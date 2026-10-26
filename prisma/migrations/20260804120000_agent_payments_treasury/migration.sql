-- Agent Payments: USDC treasury + account-level payment card (tokenized refs only)

CREATE TYPE "TreasuryWalletStatus" AS ENUM ('ACTIVE', 'FROZEN', 'CLOSED');
CREATE TYPE "PaymentCardStatus" AS ENUM ('PENDING', 'ACTIVE', 'FROZEN', 'CANCELLED');
CREATE TYPE "TreasuryTxType" AS ENUM ('FUNDING', 'WITHDRAWAL', 'RESERVE', 'RELEASE', 'SPEND', 'REFUND', 'CARD_ISSUE', 'CARD_CANCEL', 'POLICY_UPDATE', 'ADJUSTMENT');
CREATE TYPE "TreasuryTxStatus" AS ENUM ('PENDING', 'RESERVED', 'SETTLED', 'FAILED', 'REVERSED');
CREATE TYPE "FundingIntentStatus" AS ENUM ('CREATED', 'PENDING', 'CONFIRMED', 'EXPIRED', 'FAILED');

CREATE TABLE "treasury_wallets" (
    "id" TEXT NOT NULL,
    "app_account_id" TEXT NOT NULL,
    "balance_usdc_cents" INTEGER NOT NULL DEFAULT 0,
    "reserved_usdc_cents" INTEGER NOT NULL DEFAULT 0,
    "provider_wallet_id" TEXT,
    "status" "TreasuryWalletStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "treasury_wallets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payment_cards" (
    "id" TEXT NOT NULL,
    "app_account_id" TEXT NOT NULL,
    "provider_card_id" TEXT NOT NULL,
    "provider_name" TEXT NOT NULL,
    "last_four" TEXT NOT NULL,
    "brand" TEXT NOT NULL DEFAULT 'virtual',
    "expiry_month" INTEGER,
    "expiry_year" INTEGER,
    "status" "PaymentCardStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "payment_cards_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "treasury_transactions" (
    "id" TEXT NOT NULL,
    "app_account_id" TEXT NOT NULL,
    "agent_id" INTEGER,
    "wallet_id" TEXT NOT NULL,
    "card_id" TEXT,
    "type" "TreasuryTxType" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USDC',
    "merchant" TEXT,
    "category" TEXT,
    "reason" TEXT,
    "status" "TreasuryTxStatus" NOT NULL DEFAULT 'PENDING',
    "provider_transaction_id" TEXT,
    "idempotency_key" TEXT,
    "balance_after_cents" INTEGER,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "treasury_transactions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "spending_policies" (
    "id" TEXT NOT NULL,
    "app_account_id" TEXT NOT NULL,
    "daily_limit_cents" INTEGER NOT NULL DEFAULT 10000,
    "weekly_limit_cents" INTEGER NOT NULL DEFAULT 50000,
    "monthly_limit_cents" INTEGER NOT NULL DEFAULT 200000,
    "allowed_categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "blocked_categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allow_manual_usage" BOOLEAN NOT NULL DEFAULT true,
    "allow_agent_usage" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "spending_policies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "treasury_funding_intents" (
    "id" TEXT NOT NULL,
    "app_account_id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USDC',
    "status" "FundingIntentStatus" NOT NULL DEFAULT 'CREATED',
    "provider_intent_id" TEXT,
    "provider_name" TEXT NOT NULL,
    "checkout_url" TEXT,
    "idempotency_key" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "treasury_funding_intents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "treasury_audit_logs" (
    "id" TEXT NOT NULL,
    "app_account_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "treasury_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "treasury_wallets_app_account_id_key" ON "treasury_wallets"("app_account_id");
CREATE INDEX "treasury_wallets_status_idx" ON "treasury_wallets"("status");

CREATE UNIQUE INDEX "payment_cards_app_account_id_key" ON "payment_cards"("app_account_id");
CREATE INDEX "payment_cards_status_idx" ON "payment_cards"("status");
CREATE INDEX "payment_cards_provider_card_id_idx" ON "payment_cards"("provider_card_id");

CREATE UNIQUE INDEX "treasury_transactions_idempotency_key_key" ON "treasury_transactions"("idempotency_key");
CREATE INDEX "treasury_transactions_app_account_id_created_at_idx" ON "treasury_transactions"("app_account_id", "created_at");
CREATE INDEX "treasury_transactions_agent_id_created_at_idx" ON "treasury_transactions"("agent_id", "created_at");
CREATE INDEX "treasury_transactions_wallet_id_created_at_idx" ON "treasury_transactions"("wallet_id", "created_at");
CREATE INDEX "treasury_transactions_status_idx" ON "treasury_transactions"("status");
CREATE INDEX "treasury_transactions_type_idx" ON "treasury_transactions"("type");
CREATE INDEX "treasury_transactions_merchant_idx" ON "treasury_transactions"("merchant");
CREATE INDEX "treasury_transactions_category_idx" ON "treasury_transactions"("category");

CREATE UNIQUE INDEX "spending_policies_app_account_id_key" ON "spending_policies"("app_account_id");

CREATE UNIQUE INDEX "treasury_funding_intents_idempotency_key_key" ON "treasury_funding_intents"("idempotency_key");
CREATE INDEX "treasury_funding_intents_app_account_id_created_at_idx" ON "treasury_funding_intents"("app_account_id", "created_at");
CREATE INDEX "treasury_funding_intents_status_idx" ON "treasury_funding_intents"("status");

CREATE INDEX "treasury_audit_logs_app_account_id_created_at_idx" ON "treasury_audit_logs"("app_account_id", "created_at");
CREATE INDEX "treasury_audit_logs_entity_type_entity_id_idx" ON "treasury_audit_logs"("entity_type", "entity_id");
CREATE INDEX "treasury_audit_logs_action_idx" ON "treasury_audit_logs"("action");

ALTER TABLE "treasury_wallets" ADD CONSTRAINT "treasury_wallets_app_account_id_fkey" FOREIGN KEY ("app_account_id") REFERENCES "app_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_cards" ADD CONSTRAINT "payment_cards_app_account_id_fkey" FOREIGN KEY ("app_account_id") REFERENCES "app_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "treasury_transactions" ADD CONSTRAINT "treasury_transactions_app_account_id_fkey" FOREIGN KEY ("app_account_id") REFERENCES "app_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "treasury_transactions" ADD CONSTRAINT "treasury_transactions_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "treasury_transactions" ADD CONSTRAINT "treasury_transactions_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "treasury_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "treasury_transactions" ADD CONSTRAINT "treasury_transactions_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "payment_cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "spending_policies" ADD CONSTRAINT "spending_policies_app_account_id_fkey" FOREIGN KEY ("app_account_id") REFERENCES "app_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "treasury_funding_intents" ADD CONSTRAINT "treasury_funding_intents_app_account_id_fkey" FOREIGN KEY ("app_account_id") REFERENCES "app_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "treasury_funding_intents" ADD CONSTRAINT "treasury_funding_intents_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "treasury_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "treasury_audit_logs" ADD CONSTRAINT "treasury_audit_logs_app_account_id_fkey" FOREIGN KEY ("app_account_id") REFERENCES "app_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
