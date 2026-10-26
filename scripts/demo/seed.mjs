#!/usr/bin/env node

/**
 * Load the committed demo snapshot into an empty, migrated database.
 *
 *   DEMO_MODE=true DATABASE_URL=postgresql://... node scripts/demo/seed.mjs
 *
 * Run `pnpm db:migrate` against the same database first. The script replaces
 * the snapshot tables, so it refuses to run outside DEMO_MODE or against a
 * database that already holds more agents than the snapshot (a real index).
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import pg from "pg";
import { DEMO_SNAPSHOT_DIR, DEMO_SNAPSHOT_TABLES } from "./snapshot-schema.mjs";

const { Client } = pg;

const { values } = parseArgs({
  options: {
    force: { type: "boolean", default: false },
  },
  strict: true,
});

if (process.env.DEMO_MODE !== "true") {
  console.error("Refusing to seed: DEMO_MODE=true is required.");
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const snapshot = Object.fromEntries(
  DEMO_SNAPSHOT_TABLES.map((table) => [
    table,
    JSON.parse(fs.readFileSync(path.join(DEMO_SNAPSHOT_DIR, `${table}.json`), "utf8")),
  ]),
);

const client = new Client({ connectionString });
await client.connect();

try {
  const { rows } = await client.query(`SELECT count(*)::int AS count FROM "Agent"`);
  if (rows[0].count > snapshot.Agent.length && !values.force) {
    console.error(
      `Refusing to seed: target already has ${rows[0].count} agents (snapshot has ${snapshot.Agent.length}). ` +
        "This looks like a real index; pass --force only for a disposable demo database.",
    );
    process.exit(1);
  }

  await client.query("BEGIN");
  await client.query(
    `TRUNCATE ${DEMO_SNAPSHOT_TABLES.map((table) => `"${table}"`).join(", ")} RESTART IDENTITY CASCADE`,
  );
  for (const table of DEMO_SNAPSHOT_TABLES) {
    const result = await client.query(
      `INSERT INTO "${table}" SELECT * FROM jsonb_populate_recordset(NULL::"${table}", $1::jsonb)`,
      [JSON.stringify(snapshot[table])],
    );
    // Keep autoincrement ids ahead of the imported rows.
    await client.query(
      `SELECT setval(pg_get_serial_sequence($1, 'id'), GREATEST((SELECT COALESCE(max(id), 0) FROM "${table}"), 1))
        WHERE pg_get_serial_sequence($1, 'id') IS NOT NULL`,
      [`"${table}"`],
    );
    console.log(`${table}: ${result.rowCount} rows`);
  }
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end();
}
