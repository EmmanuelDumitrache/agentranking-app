-- CreateTable
CREATE TABLE "agent_trades" (
    "id" TEXT NOT NULL,
    "agent_db_id" INTEGER NOT NULL,
    "side" TEXT NOT NULL,
    "input_mint" TEXT NOT NULL,
    "output_mint" TEXT NOT NULL,
    "input_amount" TEXT NOT NULL,
    "output_amount" TEXT NOT NULL,
    "signature" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "slippage_bps" INTEGER NOT NULL,
    "price_impact_pct" TEXT,
    "token_symbol" TEXT,
    "token_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMP(3),

    CONSTRAINT "agent_trades_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_trades_signature_key" ON "agent_trades"("signature");

-- CreateIndex
CREATE INDEX "agent_trades_agent_db_id_created_at_idx" ON "agent_trades"("agent_db_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_trades_status_idx" ON "agent_trades"("status");

-- AddForeignKey
ALTER TABLE "agent_trades" ADD CONSTRAINT "agent_trades_agent_db_id_fkey" FOREIGN KEY ("agent_db_id") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
