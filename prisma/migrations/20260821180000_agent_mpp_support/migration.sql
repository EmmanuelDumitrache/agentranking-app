-- Agent payment rails: MPP (Machine Payments Protocol) beside x402.
ALTER TABLE "Agent"
  ADD COLUMN IF NOT EXISTS "declared_mpp_support" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "mppSupport" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "Agent_isActive_mppSupport_idx"
  ON "Agent" ("isActive", "mppSupport");
