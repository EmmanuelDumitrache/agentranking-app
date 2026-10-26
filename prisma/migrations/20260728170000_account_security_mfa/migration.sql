-- Account security: TOTP MFA, backup codes, email OTP MFA flag, audit log
ALTER TABLE "UserProfile" ADD COLUMN IF NOT EXISTS "totp_enabled_at" TIMESTAMP(3);
ALTER TABLE "UserProfile" ADD COLUMN IF NOT EXISTS "totp_secret_enc" TEXT;
ALTER TABLE "UserProfile" ADD COLUMN IF NOT EXISTS "totp_backup_codes_hash" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "UserProfile" ADD COLUMN IF NOT EXISTS "email_otp_mfa_enabled_at" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "account_security_audits" (
    "id" TEXT NOT NULL,
    "user_profile_id" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "actor" TEXT NOT NULL DEFAULT 'user',
    "metadata_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "account_security_audits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "account_security_audits_user_profile_id_created_at_idx"
  ON "account_security_audits"("user_profile_id", "created_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'account_security_audits_user_profile_id_fkey'
  ) THEN
    ALTER TABLE "account_security_audits"
      ADD CONSTRAINT "account_security_audits_user_profile_id_fkey"
      FOREIGN KEY ("user_profile_id") REFERENCES "UserProfile"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
