CREATE TABLE "worker_queue_health" (
    "queue_name" TEXT NOT NULL,
    "last_completed_at" TIMESTAMPTZ(3),
    "last_completed_status" TEXT,
    "last_completed_reason" TEXT,
    "last_failed_at" TIMESTAMPTZ(3),
    "last_failure_message" TEXT,
    "last_failure_pruned_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "worker_queue_health_pkey" PRIMARY KEY ("queue_name")
);

CREATE TABLE "worker_queue_failures" (
    "id" BIGSERIAL NOT NULL,
    "queue_name" TEXT NOT NULL,
    "job_id" TEXT,
    "message" TEXT,
    "failed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "worker_queue_failures_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "worker_queue_failures_queue_failed_idx"
    ON "worker_queue_failures"("queue_name", "failed_at" DESC, "id" DESC);

ALTER TABLE "worker_queue_failures"
    ADD CONSTRAINT "worker_queue_failures_queue_name_fkey"
    FOREIGN KEY ("queue_name") REFERENCES "worker_queue_health"("queue_name")
    ON DELETE CASCADE ON UPDATE CASCADE;
