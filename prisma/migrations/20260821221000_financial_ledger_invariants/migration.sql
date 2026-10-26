-- Financial balances are invariants, not application-level suggestions. Keep
-- invalid states unrepresentable even if a future writer bypasses service code.
ALTER TABLE "treasury_wallets"
  ADD CONSTRAINT "treasury_wallets_balance_nonnegative_check"
    CHECK ("balance_usdc_cents" >= 0),
  ADD CONSTRAINT "treasury_wallets_reserved_nonnegative_check"
    CHECK ("reserved_usdc_cents" >= 0),
  ADD CONSTRAINT "treasury_wallets_reserved_within_balance_check"
    CHECK ("reserved_usdc_cents" <= "balance_usdc_cents");

ALTER TABLE "agent_stablecoin_ledgers"
  ADD CONSTRAINT "agent_stablecoin_ledgers_balance_nonnegative_check"
    CHECK ("balance_usdc_cents" >= 0),
  ADD CONSTRAINT "agent_stablecoin_ledgers_reserved_nonnegative_check"
    CHECK ("reserved_usdc_cents" >= 0),
  ADD CONSTRAINT "agent_stablecoin_ledgers_reserved_within_balance_check"
    CHECK ("reserved_usdc_cents" <= "balance_usdc_cents");

-- Ledger reference pairs are idempotency identities whenever both fields are
-- present. PostgreSQL still permits multiple rows where either field is NULL.
CREATE UNIQUE INDEX "agent_stablecoin_ledger_entries_reference_type_reference_id_key"
  ON "agent_stablecoin_ledger_entries" ("reference_type", "reference_id");
