-- CreateTable
CREATE TABLE "agent_schedules" (
    "id" TEXT NOT NULL,
    "agent_db_id" INTEGER NOT NULL,
    "app_account_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'prompt',
    "status" TEXT NOT NULL DEFAULT 'active',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "cron_expr" TEXT NOT NULL,
    "next_run_at" TIMESTAMP(3) NOT NULL,
    "last_run_at" TIMESTAMP(3),
    "model_key" TEXT NOT NULL,
    "prompt_text" TEXT NOT NULL,
    "missed_policy" TEXT NOT NULL DEFAULT 'skip',
    "trade_config" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_schedule_runs" (
    "id" TEXT NOT NULL,
    "schedule_id" TEXT NOT NULL,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "model_key" TEXT NOT NULL,
    "cost_cents" INTEGER,
    "output_summary" TEXT,
    "error_message" TEXT,
    "skip_reason" TEXT,
    "conversation_id" TEXT,
    "run_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_schedule_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_schedules_agent_db_id_status_next_run_at_idx" ON "agent_schedules"("agent_db_id", "status", "next_run_at");

-- CreateIndex
CREATE INDEX "agent_schedules_app_account_id_idx" ON "agent_schedules"("app_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_schedule_runs_schedule_id_scheduled_for_key" ON "agent_schedule_runs"("schedule_id", "scheduled_for");

-- CreateIndex
CREATE INDEX "agent_schedule_runs_schedule_id_created_at_idx" ON "agent_schedule_runs"("schedule_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "agent_schedules" ADD CONSTRAINT "agent_schedules_agent_db_id_fkey" FOREIGN KEY ("agent_db_id") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_schedules" ADD CONSTRAINT "agent_schedules_app_account_id_fkey" FOREIGN KEY ("app_account_id") REFERENCES "app_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_schedule_runs" ADD CONSTRAINT "agent_schedule_runs_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "agent_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
