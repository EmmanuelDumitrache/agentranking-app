-- CreateEnum
CREATE TYPE "AgentMemoryFactKind" AS ENUM ('preference', 'fact', 'instruction', 'avoid');

-- CreateEnum
CREATE TYPE "AgentMemoryFactStatus" AS ENUM ('pending', 'active', 'archived', 'rejected');

-- CreateTable
CREATE TABLE "agent_memory_settings" (
    "id" TEXT NOT NULL,
    "agent_db_id" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "require_approval" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "agent_memory_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_memory_facts" (
    "id" TEXT NOT NULL,
    "agent_db_id" INTEGER NOT NULL,
    "kind" "AgentMemoryFactKind" NOT NULL,
    "content" VARCHAR(500) NOT NULL,
    "content_hash" VARCHAR(64) NOT NULL,
    "status" "AgentMemoryFactStatus" NOT NULL DEFAULT 'active',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
    "source_run_id" TEXT,
    "source_conversation_id" TEXT,
    "source_ordinal" SMALLINT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "agent_memory_facts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "agent_memory_facts_confidence_check" CHECK ("confidence" >= 0 AND "confidence" <= 1),
    CONSTRAINT "agent_memory_facts_source_ordinal_check" CHECK ("source_ordinal" IS NULL OR ("source_ordinal" >= 0 AND "source_ordinal" < 3))
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_memory_settings_agent_db_id_key" ON "agent_memory_settings"("agent_db_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_memory_facts_agent_db_id_content_hash_key" ON "agent_memory_facts"("agent_db_id", "content_hash");

-- CreateIndex
CREATE UNIQUE INDEX "agent_memory_facts_source_run_id_source_ordinal_key" ON "agent_memory_facts"("source_run_id", "source_ordinal");

-- CreateIndex
CREATE INDEX "agent_memory_facts_agent_db_id_status_updated_at_idx" ON "agent_memory_facts"("agent_db_id", "status", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "agent_memory_facts_agent_db_id_created_at_idx" ON "agent_memory_facts"("agent_db_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "agent_memory_settings" ADD CONSTRAINT "agent_memory_settings_agent_db_id_fkey" FOREIGN KEY ("agent_db_id") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_memory_facts" ADD CONSTRAINT "agent_memory_facts_agent_db_id_fkey" FOREIGN KEY ("agent_db_id") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
