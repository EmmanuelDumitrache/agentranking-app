-- Harden account MFA state without renaming or rewriting the migration already shipped on main.
ALTER TABLE "UserProfile"
  ADD COLUMN "totp_last_used_step" BIGINT,
  ADD COLUMN "mfa_trust_version" INTEGER NOT NULL DEFAULT 0;

-- The original account-security migration allowed NULL for compatibility while adding
-- the array column. Normalise existing rows before matching the non-null Prisma model.
UPDATE "UserProfile"
SET "totp_backup_codes_hash" = ARRAY[]::TEXT[]
WHERE "totp_backup_codes_hash" IS NULL;

ALTER TABLE "UserProfile"
  ALTER COLUMN "totp_backup_codes_hash" SET DEFAULT ARRAY[]::TEXT[],
  ALTER COLUMN "totp_backup_codes_hash" SET NOT NULL;
