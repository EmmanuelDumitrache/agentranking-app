-- CreateTable
CREATE TABLE "agent_copy_trade_configs" (
    "id" TEXT NOT NULL,
    "agent_db_id" INTEGER NOT NULL,
    "label" TEXT,
    "target_wallet" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "buy_mode" TEXT NOT NULL DEFAULT 'percentage',
    "buy_percent" INTEGER NOT NULL DEFAULT 25,
    "buy_sol_amount" DOUBLE PRECISION,
    "sell_percent" INTEGER NOT NULL DEFAULT 100,
    "max_buy_sol" DOUBLE PRECISION,
    "last_mirrored_at" TIMESTAMP(3),
    "last_mirrored_sig" TEXT,
    "mirror_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_copy_trade_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_copy_trade_configs_agent_db_id_status_idx" ON "agent_copy_trade_configs"("agent_db_id", "status");

-- CreateIndex
CREATE INDEX "agent_copy_trade_configs_target_wallet_idx" ON "agent_copy_trade_configs"("target_wallet");

-- AddForeignKey
ALTER TABLE "agent_copy_trade_configs" ADD CONSTRAINT "agent_copy_trade_configs_agent_db_id_fkey" FOREIGN KEY ("agent_db_id") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
