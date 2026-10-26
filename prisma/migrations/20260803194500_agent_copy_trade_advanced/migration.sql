-- AlterTable
ALTER TABLE "agent_copy_trade_configs" ADD COLUMN IF NOT EXISTS "sizing_mode" TEXT NOT NULL DEFAULT 'proportional';
ALTER TABLE "agent_copy_trade_configs" ADD COLUMN IF NOT EXISTS "portfolio_allocation_pct" INTEGER NOT NULL DEFAULT 100;
ALTER TABLE "agent_copy_trade_configs" ADD COLUMN IF NOT EXISTS "max_position_usd" DOUBLE PRECISION;
ALTER TABLE "agent_copy_trade_configs" ADD COLUMN IF NOT EXISTS "leverage" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "agent_copy_trade_configs" ADD COLUMN IF NOT EXISTS "loop_cadence_sec" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "agent_copy_trade_configs" ADD COLUMN IF NOT EXISTS "llm_model_key" TEXT;
ALTER TABLE "agent_copy_trade_configs" ADD COLUMN IF NOT EXISTS "llm_budget_usd" DOUBLE PRECISION;
