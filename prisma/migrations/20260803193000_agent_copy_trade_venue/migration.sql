-- AlterTable
ALTER TABLE "agent_copy_trade_configs" ADD COLUMN IF NOT EXISTS "venue" TEXT NOT NULL DEFAULT 'spot';
