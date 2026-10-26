-- CreateTable
CREATE TABLE "agent_kripicard_cards" (
    "id" TEXT NOT NULL,
    "agent_id" INTEGER NOT NULL,
    "app_account_id" TEXT NOT NULL,
    "kripicard_card_id" TEXT NOT NULL,
    "bin" TEXT NOT NULL,
    "provider_name" TEXT NOT NULL DEFAULT 'ar',
    "last_four" TEXT NOT NULL,
    "brand" TEXT NOT NULL DEFAULT 'mastercard',
    "name_on_card" TEXT NOT NULL,
    "status" "AgentIssuingCardStatus" NOT NULL DEFAULT 'ACTIVE',
    "risk_tier" TEXT NOT NULL,
    "initial_amount_usd" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_kripicard_cards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_kripicard_cards_agent_id_key" ON "agent_kripicard_cards"("agent_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_kripicard_cards_kripicard_card_id_key" ON "agent_kripicard_cards"("kripicard_card_id");

-- CreateIndex
CREATE INDEX "agent_kripicard_cards_app_account_id_idx" ON "agent_kripicard_cards"("app_account_id");

-- CreateIndex
CREATE INDEX "agent_kripicard_cards_status_idx" ON "agent_kripicard_cards"("status");

-- AddForeignKey
ALTER TABLE "agent_kripicard_cards" ADD CONSTRAINT "agent_kripicard_cards_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_kripicard_cards" ADD CONSTRAINT "agent_kripicard_cards_app_account_id_fkey" FOREIGN KEY ("app_account_id") REFERENCES "app_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
