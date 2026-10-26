#!/usr/bin/env node

/**
 * Export a sanitized, public-only agent snapshot for DEMO_MODE.
 *
 *   DEMO_SOURCE_DATABASE_URL=postgresql://... node scripts/demo/export-snapshot.mjs --limit 400 --verify-images
 *
 * Only on-chain registry data is exported. Every column that links an agent to
 * an AgentRanking account, custodial wallet, referral code, or internal error
 * text is cleared, AgentRanking-native (dashboard-created) agents are skipped,
 * and no account, session, order, payment, chat, or wallet tables are read.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import pg from "pg";
import {
  AGENT_PRIVATE_COLUMN_RESETS,
  DAO_LEADERBOARD_PRIVATE_COLUMN_RESETS,
  DEMO_SNAPSHOT_DIR,
  DEMO_SNAPSHOT_TABLES,
  NATIVE_AGENTRANKING_CHAIN_ID,
} from "./snapshot-schema.mjs";

const { Client } = pg;

const { values } = parseArgs({
  options: {
    limit: { type: "string", default: "400" },
    "verify-images": { type: "boolean", default: false },
  },
  strict: true,
});

const limit = Number.parseInt(values.limit, 10);
if (!Number.isInteger(limit) || limit < 1 || limit > 2000) {
  console.error("--limit must be an integer between 1 and 2000");
  process.exit(1);
}

const connectionString = process.env.DEMO_SOURCE_DATABASE_URL?.trim();
if (!connectionString) {
  console.error("DEMO_SOURCE_DATABASE_URL is required (the database to read the public snapshot from).");
  process.exit(1);
}

/** Agents whose logo 404s render as broken images, so --verify-images skips them. */
async function imageLoads(url) {
  if (!url) return true;
  // IPFS logos render through the app's gateway.
  if (/^ipfs:\/\//i.test(url)) return true;
  // Inline SVGs are sometimes stored truncated; only keep complete documents.
  const inlineSvg = /^data:image\/svg\+xml;base64,(.+)$/i.exec(url);
  if (inlineSvg) return Buffer.from(inlineSvg[1], "base64").toString("utf8").trimEnd().endsWith("</svg>");
  if (/^data:image\//i.test(url)) return true;
  if (!/^https?:\/\//i.test(url)) return false;
  try {
    const response = await fetch(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(8_000) });
    await response.body?.cancel();
    const type = response.headers.get("content-type") ?? "";
    return response.ok && (type.startsWith("image/") || type.startsWith("application/octet-stream"));
  } catch {
    return false;
  }
}

const client = new Client({ connectionString });
await client.connect();

try {
  await client.query("BEGIN READ ONLY");

  // Prefer complete listings and keep the directory varied: bulk registrations
  // share a logo ("per_image") or a numbered name ("Room 12", "Room 13"), so
  // each logo is capped at eight agents and each name family at four.
  const { rows: candidates } = await client.query(
    `SELECT id, image FROM (
       SELECT a.id,
              a.image,
              a.image <> '' AND length(a.description) > 40 AS complete,
              a."agentRankScore",
              row_number() OVER (PARTITION BY NULLIF(a.image, '') ORDER BY a."agentRankScore" DESC, a.id) AS per_image,
              row_number() OVER (
                PARTITION BY regexp_replace(lower(a.name), '[[:space:]#_-]*[0-9]+$', '')
                ORDER BY a."agentRankScore" DESC, a.id
              ) AS per_family
         FROM "Agent" a
        WHERE a."chainId" <> $1
          AND a.publicly_active
          AND a.moderation_status = 'inherit'
          AND a.name <> ''
     ) ranked
      WHERE per_family <= 4 AND (per_image <= 8 OR NOT complete)
      ORDER BY complete DESC, per_image ASC, per_family ASC, "agentRankScore" DESC, id ASC`,
    [NATIVE_AGENTRANKING_CHAIN_ID],
  );
  const agentIds = [];
  for (let i = 0; i < candidates.length && agentIds.length < limit; i += 16) {
    const batch = candidates.slice(i, i + 16);
    const usable = values["verify-images"]
      ? await Promise.all(batch.map((row) => imageLoads(row.image)))
      : batch.map(() => true);
    batch.forEach((row, index) => {
      if (usable[index] && agentIds.length < limit) agentIds.push(row.id);
    });
  }

  const queries = {
    Chain: [`SELECT to_jsonb(c) AS row FROM "Chain" c ORDER BY c.id`, []],
    Agent: [
      `SELECT to_jsonb(a) || $2::jsonb AS row FROM "Agent" a WHERE a.id = ANY($1::int[]) ORDER BY a.id`,
      [agentIds, JSON.stringify(AGENT_PRIVATE_COLUMN_RESETS)],
    ],
    AgentMetadata: [
      `SELECT to_jsonb(m) AS row FROM "AgentMetadata" m WHERE m."agentId" = ANY($1::int[]) ORDER BY m.id`,
      [agentIds],
    ],
    AgentService: [
      `SELECT to_jsonb(s) AS row FROM "AgentService" s WHERE s."agentId" = ANY($1::int[]) ORDER BY s.id`,
      [agentIds],
    ],
    DaoLeaderboardLive: [
      `SELECT to_jsonb(d) || $2::jsonb AS row FROM "DaoLeaderboardLive" d WHERE d."agentId" = ANY($1::int[]) ORDER BY d.id`,
      [agentIds, JSON.stringify(DAO_LEADERBOARD_PRIVATE_COLUMN_RESETS)],
    ],
  };

  fs.mkdirSync(DEMO_SNAPSHOT_DIR, { recursive: true });
  for (const table of DEMO_SNAPSHOT_TABLES) {
    const [sql, params] = queries[table];
    const { rows } = await client.query(sql, params);
    // One row per line keeps snapshot diffs reviewable.
    const body = `[\n${rows.map((row) => JSON.stringify(row.row)).join(",\n")}\n]\n`;
    fs.writeFileSync(path.join(DEMO_SNAPSHOT_DIR, `${table}.json`), body);
    console.log(`${table}: ${rows.length} rows`);
  }

  await client.query("COMMIT");
} finally {
  await client.end();
}
