-- Run in Supabase SQL Editor if `npx prisma migrate deploy` fails on the transaction pooler
-- (prepared statement / PgBouncer). Safe to run multiple times.
CREATE INDEX IF NOT EXISTS "AgentMetadata_key_idx" ON "AgentMetadata" ("key");
