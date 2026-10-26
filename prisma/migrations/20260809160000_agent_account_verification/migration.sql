-- CreateEnum
CREATE TYPE "AccountVerificationLevel" AS ENUM ('NONE', 'INDIVIDUAL', 'BUSINESS');

-- CreateEnum
CREATE TYPE "AccountVerificationStatus" AS ENUM ('UNVERIFIED', 'PENDING', 'VERIFIED', 'NEEDS_REVIEW', 'DECLINED', 'EXPIRED', 'REVOKED');

-- AlterTable: add verification columns (public_id nullable first for backfill)
ALTER TABLE "app_accounts" ADD COLUMN "public_id" TEXT;
ALTER TABLE "app_accounts" ADD COLUMN "verification_level" "AccountVerificationLevel" NOT NULL DEFAULT 'NONE';
ALTER TABLE "app_accounts" ADD COLUMN "verification_status" "AccountVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED';
ALTER TABLE "app_accounts" ADD COLUMN "verified_at" TIMESTAMP(3);
ALTER TABLE "app_accounts" ADD COLUMN "verification_expires_at" TIMESTAMP(3);
ALTER TABLE "app_accounts" ADD COLUMN "verification_revoked_at" TIMESTAMP(3);

-- Backfill opaque public IDs: AR- + first 12 chars of cuid (no PII)
UPDATE "app_accounts"
SET "public_id" = 'AR-' || UPPER(SUBSTRING(REPLACE("id", 'c', 'C'), 1, 12))
WHERE "public_id" IS NULL;

-- Ensure uniqueness for any collisions
UPDATE "app_accounts" a
SET "public_id" = 'AR-' || UPPER(SUBSTRING(REPLACE(a."id", 'c', 'C'), 1, 8)) || SUBSTRING(MD5(a."id"), 1, 4)
WHERE EXISTS (
  SELECT 1 FROM "app_accounts" b
  WHERE b."public_id" = a."public_id" AND b."id" <> a."id"
);

ALTER TABLE "app_accounts" ALTER COLUMN "public_id" SET NOT NULL;
CREATE UNIQUE INDEX "app_accounts_public_id_key" ON "app_accounts"("public_id");

-- CreateTable
CREATE TABLE "account_verifications" (
    "id" TEXT NOT NULL,
    "app_account_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_reference" TEXT NOT NULL,
    "provider_session_id" TEXT,
    "level" "AccountVerificationLevel" NOT NULL DEFAULT 'INDIVIDUAL',
    "status" "AccountVerificationStatus" NOT NULL,
    "verified_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "webhook_event_id" TEXT,
    "attestation_uid" TEXT,
    "attestation_chain_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_verifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "account_verifications_webhook_event_id_key" ON "account_verifications"("webhook_event_id");
CREATE INDEX "account_verifications_app_account_id_created_at_idx" ON "account_verifications"("app_account_id", "created_at");
CREATE INDEX "account_verifications_provider_reference_idx" ON "account_verifications"("provider_reference");
CREATE INDEX "account_verifications_status_idx" ON "account_verifications"("status");

ALTER TABLE "account_verifications" ADD CONSTRAINT "account_verifications_app_account_id_fkey" FOREIGN KEY ("app_account_id") REFERENCES "app_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
