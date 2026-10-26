#!/usr/bin/env node

import process from "node:process";
import { parseArgs } from "node:util";
import pg from "pg";

const { Client } = pg;

const { values } = parseArgs({
  options: {
    verbose: { type: "boolean", default: false },
  },
  strict: true,
});

const REQUIRED_EXTENSIONS = [
  "btree_gin",
  "btree_gist",
  "pg_stat_statements",
  "pg_trgm",
  "unaccent",
];

const REQUIRED_EXTENSION_SCHEMA = "public";

function parsePgTextArray(value) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string" || value.length < 2) return [];
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return [];
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return [];
  return inner.split(",").map((entry) => entry.trim().replace(/^"(.*)"$/, "$1"));
}

const REQUIRED_PLANNER_STATISTICS = [
  {
    name: "agent_public_search_lifecycle_stats",
    table: "Agent",
    kinds: ["f", "m"],
    columns: ["chainId", "isActive", "publicly_active"],
    minTarget: 500,
  },
  {
    name: "agent_chat_artifact_scope_stats",
    table: "agent_chat_artifacts",
    kinds: ["d", "f", "m"],
    columns: ["conversation_id", "run_id", "state_changing"],
    minTarget: 500,
  },
  {
    name: "partner_jobs_public_search_scope_stats",
    table: "partner_jobs",
    kinds: ["f", "m"],
    columns: ["is_sample", "source", "status"],
    minTarget: 300,
  },
];

const REQUIRED_EXPRESSION_STATISTICS_TARGETS = [
  { index: "agent_name_unaccent_trgm_idx", column: 1, minTarget: 500 },
  { index: "agent_name_fuzzy_gist_idx", column: 1, minTarget: 500 },
  { index: "agent_chat_messages_search_text_gin_idx", column: 2, minTarget: 250 },
];

const REQUIRED_INDEXES = [
  "agent_chat_artifacts_lexical_search_gin_idx",
  "agent_chat_messages_search_text_gin_idx",
  "agent_directory_search_gin_idx",
  "agent_metadata_search_gin_idx",
  "agent_name_fuzzy_gist_idx",
  "agent_name_unaccent_trgm_idx",
  "agent_registry_endpoint_search_gin_idx",
  "agent_service_endpoint_search_gin_idx",
  "Agent_sap_leaderboard_idx",
  "agent_sap_capabilities_agent_ordinal_unique",
  "agent_sap_capabilities_key_agent_idx",
  "agent_sap_capabilities_protocol_agent_idx",
  "app_accounts_creator_search_gin_idx",
  "custodial_wallets_public_key_trgm_idx",
  "feedback_client_address_trgm_idx",
  "order_number_pattern_trgm_idx",
  "partner_jobs_public_search_gin_idx",
  "partner_jobs_facets_idx",
  "partner_jobs_tags_idx",
  "AgentAlertRule_eventTypes_idx",
  "agent_memory_extraction_outbox_source_message_unique",
  "treasury_transactions_account_merchant_search_gin_idx",
  "user_profile_search_gin_idx",
];

const BTREE_REQUIRED_INDEXES = new Set([
  "Agent_sap_leaderboard_idx",
  "agent_sap_capabilities_agent_ordinal_unique",
  "agent_sap_capabilities_key_agent_idx",
  "agent_sap_capabilities_protocol_agent_idx",
  "agent_memory_extraction_outbox_source_message_unique",
]);

const REQUIRED_INDEX_ACCESS_METHODS = new Map(
  REQUIRED_INDEXES.map((name) => [
    name,
    BTREE_REQUIRED_INDEXES.has(name)
      ? "btree"
      : name === "agent_name_fuzzy_gist_idx"
        ? "gist"
        : "gin",
  ]),
);

const REQUIRED_INDEX_DEFINITION_TERMS = new Map([
  [
    "agent_chat_artifacts_lexical_search_gin_idx",
    [
      "conversation_id",
      "run_id",
      "state_changing",
      "search_text",
      "preview_text",
      "digest_text",
      "tool_name",
      "gin_trgm_ops",
    ],
  ],
  [
    "agent_chat_messages_search_text_gin_idx",
    ["conversation_id", "agentranking_search_normalize", "search_text", "gin_trgm_ops"],
  ],
  [
    "agent_directory_search_gin_idx",
    [
      "isActive",
      "publicly_active",
      "chainId",
      "name",
      "description",
      "owner",
      "verifiedWallet",
      "tokenAddress",
      "supportedTrust",
      "gin_trgm_ops",
    ],
  ],
  [
    "agent_metadata_search_gin_idx",
    ["key", "value", "registrations", "tags", "telegramBotUsername", "gin_trgm_ops"],
  ],
  [
    "agent_name_fuzzy_gist_idx",
    ["agentranking_search_normalize", "name", "gist_trgm_ops", "isActive", "publicly_active"],
  ],
  [
    "agent_name_unaccent_trgm_idx",
    ["agentranking_search_normalize", "name", "gin_trgm_ops"],
  ],
  [
    "agent_registry_endpoint_search_gin_idx",
    [
      "agentURI",
      "registration_normalized_uri",
      "sap_x402_endpoint",
      "metaplex_agent_registration_uri",
      "gin_trgm_ops",
    ],
  ],
  [
    "agent_sap_capabilities_key_agent_idx",
    ["capability_key", "agent_db_id"],
  ],
  [
    "agent_sap_capabilities_protocol_agent_idx",
    ["protocol", "agent_db_id"],
  ],
  [
    "Agent_sap_leaderboard_idx",
    ["sap_verified", "isActive", "sap_reputation_score", "sap_registered_at"],
  ],
  [
    "partner_jobs_facets_idx",
    ["facets"],
  ],
  [
    "AgentAlertRule_eventTypes_idx",
    ["eventTypes"],
  ],
  [
    "agent_service_endpoint_search_gin_idx",
    ["source_kind", "endpoint", "gin_trgm_ops"],
  ],
  [
    "app_accounts_creator_search_gin_idx",
    ["email", "display_name", "gin_trgm_ops"],
  ],
  ["custodial_wallets_public_key_trgm_idx", ["public_key", "gin_trgm_ops"]],
  ["feedback_client_address_trgm_idx", ["clientAddress", "gin_trgm_ops"]],
  ["order_number_pattern_trgm_idx", ["orderNumber", "gin_trgm_ops"]],
  [
    "partner_jobs_public_search_gin_idx",
    [
      "source",
      "status",
      "title",
      "description",
      "category",
      "job_type",
      "is_sample",
      "gin_trgm_ops",
    ],
  ],
  [
    "treasury_transactions_account_merchant_search_gin_idx",
    ["app_account_id", "merchant", "gin_trgm_ops"],
  ],
  [
    "user_profile_search_gin_idx",
    [
      "subscriptionStatus",
      "email",
      "walletAddress",
      "username",
      "displayName",
      "gin_trgm_ops",
    ],
  ],
]);

function fail(message) {
  console.error(`[postgres-extensions] ${message}`);
  process.exitCode = 1;
}

function preloadLibraries(value) {
  return new Set(
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  throw new Error("DATABASE_URL is required");
}

const client = new Client({
  connectionString,
  application_name: "agentranking-extension-check",
});

try {
  await client.connect();

  const extensionResult = await client.query(
    `SELECT
       e.extname,
       e.extversion,
       n.nspname AS schema_name,
       a.default_version
       FROM pg_extension e
       JOIN pg_namespace n ON n.oid = e.extnamespace
       LEFT JOIN pg_available_extensions a ON a.name = e.extname
      WHERE e.extname = ANY($1::text[])
      ORDER BY e.extname`,
    [REQUIRED_EXTENSIONS],
  );
  const extensions = new Map(extensionResult.rows.map((row) => [row.extname, row]));
  const missingExtensions = REQUIRED_EXTENSIONS.filter((name) => !extensions.has(name));
  if (missingExtensions.length > 0) {
    fail(`missing required extensions: ${missingExtensions.join(", ")}`);
  }
  for (const name of REQUIRED_EXTENSIONS) {
    const extension = extensions.get(name);
    if (!extension) continue;
    if (extension.schema_name !== REQUIRED_EXTENSION_SCHEMA) {
      fail(
        `${name} must be installed in schema ${REQUIRED_EXTENSION_SCHEMA}, received ${extension.schema_name}`,
      );
    }
    if (!extension.default_version) {
      fail(`${name} is installed but is not available from the current PostgreSQL package`);
    } else if (extension.extversion !== extension.default_version) {
      fail(
        `${name} must be upgraded to package default ${extension.default_version}, received ${extension.extversion}`,
      );
    }
  }

  const settingsResult = await client.query(`
    SELECT
      current_setting('shared_preload_libraries') AS shared_preload_libraries,
      current_setting('compute_query_id') AS compute_query_id,
      current_setting('track_io_timing') AS track_io_timing,
      current_setting('pg_stat_statements.max', true) AS pg_stat_statements_max,
      current_setting('pg_stat_statements.track', true) AS pg_stat_statements_track,
      current_setting('pg_stat_statements.track_utility', true) AS pg_stat_statements_track_utility,
      current_setting('pg_stat_statements.track_planning', true) AS pg_stat_statements_track_planning,
      current_setting('pg_stat_statements.save', true) AS pg_stat_statements_save
  `);
  const settings = settingsResult.rows[0];
  const preloaded = preloadLibraries(settings.shared_preload_libraries ?? "");
  if (!preloaded.has("pg_stat_statements")) {
    fail("pg_stat_statements is installed but not present in shared_preload_libraries");
  }
  if (!new Set(["on", "auto"]).has(settings.compute_query_id)) {
    fail(`compute_query_id must be on or auto, received ${settings.compute_query_id}`);
  }
  if (settings.track_io_timing !== "on") {
    fail(`track_io_timing must be on, received ${settings.track_io_timing}`);
  }
  if (settings.pg_stat_statements_track !== "all") {
    fail(`pg_stat_statements.track must be all, received ${settings.pg_stat_statements_track}`);
  }
  if (settings.pg_stat_statements_track_utility !== "off") {
    fail(`pg_stat_statements.track_utility must be off, received ${settings.pg_stat_statements_track_utility}`);
  }
  if (settings.pg_stat_statements_track_planning !== "off") {
    fail(`pg_stat_statements.track_planning must be off, received ${settings.pg_stat_statements_track_planning}`);
  }
  if (settings.pg_stat_statements_save !== "on") {
    fail(`pg_stat_statements.save must be on, received ${settings.pg_stat_statements_save}`);
  }
  const pgStatStatementsMax = Number.parseInt(settings.pg_stat_statements_max, 10);
  if (!Number.isInteger(pgStatStatementsMax) || pgStatStatementsMax < 10_000) {
    fail(`pg_stat_statements.max must be at least 10000, received ${settings.pg_stat_statements_max}`);
  }

  try {
    await client.query(`
      SELECT queryid
        FROM pg_stat_statements
       WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
       LIMIT 1
    `);
  } catch (error) {
    fail(`pg_stat_statements is not queryable: ${error instanceof Error ? error.message : String(error)}`);
  }

  const functionResult = await client.query(`
    SELECT
      expected.name,
      p.provolatile,
      p.proparallel,
      p.proisstrict,
      CASE WHEN p.oid IS NULL THEN NULL ELSE pg_get_functiondef(p.oid) END AS definition
      FROM (VALUES
        ('agentranking_search_normalize', to_regprocedure('public.agentranking_search_normalize(text)')),
        ('agentranking_search_normalize_jsonb', to_regprocedure('public.agentranking_search_normalize_jsonb(jsonb)'))
      ) AS expected(name, oid)
      LEFT JOIN pg_proc p ON p.oid = expected.oid
  `);
  const normalizers = new Map(functionResult.rows.map((row) => [row.name, row]));
  for (const name of ["agentranking_search_normalize", "agentranking_search_normalize_jsonb"]) {
    const normalizer = normalizers.get(name);
    if (!normalizer?.provolatile) {
      fail(`search normalization function is missing: public.${name}`);
      continue;
    }
    if (
      normalizer.provolatile !== "i"
      || normalizer.proparallel !== "s"
      || !normalizer.proisstrict
    ) {
      fail(`public.${name} must be IMMUTABLE PARALLEL SAFE STRICT`);
    }
    const definition = String(normalizer.definition ?? "");
    const requiredTerms = name === "agentranking_search_normalize"
      ? ["lower", "public.unaccent", "regdictionary"]
      : ["agentranking_search_normalize", "input::text"];
    const missingTerms = requiredTerms.filter((term) => !definition.includes(term));
    if (missingTerms.length > 0) {
      fail(`public.${name} definition is missing: ${missingTerms.join(", ")}`);
    }
  }

  if (process.exitCode !== 1) {
    const capabilityProbe = await client.query(`
      SELECT
        public.agentranking_search_normalize('ÀGENT') = 'agent' AS unaccent_normalization,
        public.similarity('agent', 'agent') = 1.0 AS trigram_similarity
    `);
    if (!capabilityProbe.rows[0]?.unaccent_normalization) {
      fail("unaccent normalization capability probe failed");
    }
    if (!capabilityProbe.rows[0]?.trigram_similarity) {
      fail("pg_trgm similarity capability probe failed");
    }
  }

  const indexResult = await client.query(
    `SELECT
       c.relname,
       am.amname AS access_method,
       pg_get_indexdef(c.oid) AS definition
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_index i ON i.indexrelid = c.oid
       JOIN pg_am am ON am.oid = c.relam
      WHERE n.nspname = 'public'
        AND c.relkind = 'i'
        AND i.indisready
        AND i.indisvalid
        AND c.relname = ANY($1::text[])`,
    [REQUIRED_INDEXES],
  );
  const indexes = new Map(indexResult.rows.map((row) => [row.relname, row]));
  const missingIndexes = REQUIRED_INDEXES.filter((name) => !indexes.has(name));
  if (missingIndexes.length > 0) {
    fail(`missing required extension-backed indexes: ${missingIndexes.join(", ")}`);
  }
  for (const [name, row] of indexes) {
    const expectedMethod = REQUIRED_INDEX_ACCESS_METHODS.get(name);
    if (expectedMethod && row.access_method !== expectedMethod) {
      fail(`${name} must use ${expectedMethod}, received ${row.access_method}`);
    }
    const definition = String(row.definition ?? "");
    const missingTerms = (REQUIRED_INDEX_DEFINITION_TERMS.get(name) ?? [])
      .filter((term) => !definition.includes(term));
    if (missingTerms.length > 0) {
      fail(`${name} is missing required index definition terms: ${missingTerms.join(", ")}`);
    }
  }

  const plannerStatsResult = await client.query(
    `SELECT
       s.stxname,
       c.relname AS table_name,
       tn.nspname AS table_schema,
       sn.nspname AS statistics_schema,
       GREATEST(c.reltuples::bigint, 0) AS estimated_rows,
       s.stxkind AS kinds,
       ARRAY(
         SELECT a.attname
           FROM unnest(s.stxkeys) WITH ORDINALITY AS stat_key(attnum, ordinal)
           JOIN pg_attribute a
             ON a.attrelid = s.stxrelid
            AND a.attnum = stat_key.attnum
          ORDER BY stat_key.ordinal
       ) AS columns,
       s.stxstattarget AS statistics_target,
       pg_get_statisticsobjdef(s.oid) AS definition,
       EXISTS (
         SELECT 1
           FROM pg_stats_ext visible
          WHERE visible.schemaname = tn.nspname
            AND visible.tablename = c.relname
            AND visible.statistics_schemaname = sn.nspname
            AND visible.statistics_name = s.stxname
       ) AS populated
       FROM pg_statistic_ext s
       JOIN pg_class c ON c.oid = s.stxrelid
       JOIN pg_namespace tn ON tn.oid = c.relnamespace
       JOIN pg_namespace sn ON sn.oid = s.stxnamespace
      WHERE sn.nspname = 'public'
        AND s.stxname = ANY($1::text[])`,
    [REQUIRED_PLANNER_STATISTICS.map((entry) => entry.name)],
  );
  const plannerStats = new Map(
    plannerStatsResult.rows.map((row) => [row.stxname, row]),
  );
  for (const required of REQUIRED_PLANNER_STATISTICS) {
    const stats = plannerStats.get(required.name);
    if (!stats) {
      fail(`missing required planner statistics: ${required.name}`);
      continue;
    }
    if (stats.table_schema !== "public" || stats.table_name !== required.table) {
      fail(
        `${required.name} must target public.${required.table}, received ${stats.table_schema}.${stats.table_name}`,
      );
    }
    const kinds = new Set(parsePgTextArray(stats.kinds));
    const missingKinds = required.kinds.filter((kind) => !kinds.has(kind));
    const unexpectedKinds = [...kinds].filter((kind) => !required.kinds.includes(kind));
    if (missingKinds.length > 0 || unexpectedKinds.length > 0) {
      fail(
        `${required.name} statistics kinds drifted; missing=${missingKinds.join(",") || "none"}; unexpected=${unexpectedKinds.join(",") || "none"}`,
      );
    }
    const columns = new Set(parsePgTextArray(stats.columns));
    const missingColumns = required.columns.filter((column) => !columns.has(column));
    const unexpectedColumns = [...columns].filter((column) => !required.columns.includes(column));
    if (missingColumns.length > 0 || unexpectedColumns.length > 0) {
      fail(
        `${required.name} columns drifted; missing=${missingColumns.join(",") || "none"}; unexpected=${unexpectedColumns.join(",") || "none"}`,
      );
    }
    const definition = String(stats.definition ?? "");
    const definitionMissingColumns = required.columns.filter((column) => !definition.includes(column));
    if (definitionMissingColumns.length > 0) {
      fail(`${required.name} reconstructed definition is missing: ${definitionMissingColumns.join(", ")}`);
    }
    const target = Number(stats.statistics_target);
    if (!Number.isInteger(target) || target < required.minTarget) {
      fail(
        `${required.name} statistics target must be at least ${required.minTarget}, received ${stats.statistics_target}`,
      );
    }
    if (!stats.populated && Number(stats.estimated_rows) > 0) {
      fail(`${required.name} has not been populated by ANALYZE`);
    }
  }

  const expressionStatsResult = await client.query(
    `SELECT c.relname, a.attnum, a.attstattarget
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.oid
      WHERE n.nspname = 'public'
        AND c.relname = ANY($1::text[])
        AND a.attnum > 0`,
    [[...new Set(REQUIRED_EXPRESSION_STATISTICS_TARGETS.map((entry) => entry.index))]],
  );
  const expressionTargets = new Map(
    expressionStatsResult.rows.map((row) => [
      `${row.relname}:${Number(row.attnum)}`,
      Number(row.attstattarget),
    ]),
  );
  for (const required of REQUIRED_EXPRESSION_STATISTICS_TARGETS) {
    const key = `${required.index}:${required.column}`;
    const target = expressionTargets.get(key);
    if (!Number.isInteger(target) || target < required.minTarget) {
      fail(
        `${required.index} expression column ${required.column} statistics target must be at least ${required.minTarget}, received ${target ?? "missing"}`,
      );
    }
  }

  const constraintResult = await client.query(`
    SELECT pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'public'
       AND r.relname = 'indexer_range_leases'
       AND c.conname = 'indexer_range_leases_non_overlapping_active'
       AND c.contype = 'x'
       AND c.convalidated
  `);
  const rangeConstraintDefinition = String(constraintResult.rows[0]?.definition ?? "");
  if (!rangeConstraintDefinition) {
    fail("indexer range overlap exclusion constraint is missing");
  } else {
    const requiredTerms = [
      "EXCLUDE USING gist",
      "source_key",
      "int8range",
      "from_block",
      "to_block",
      "WITH &&",
      "INVALIDATED",
    ];
    const missingTerms = requiredTerms.filter((term) => !rangeConstraintDefinition.includes(term));
    if (missingTerms.length > 0) {
      fail(`indexer range overlap exclusion constraint is missing: ${missingTerms.join(", ")}`);
    }
  }

  if (process.exitCode !== 1) {
    console.log(
      `[postgres-extensions] ready: ${REQUIRED_EXTENSIONS.join(", ")}; package-default versions in public; pg_stat_statements preloaded/track=all; ${REQUIRED_INDEXES.length} extension-backed indexes and ${REQUIRED_PLANNER_STATISTICS.length} planner-statistics objects verified`,
    );
    if (values.verbose) {
      console.table(extensionResult.rows.map((row) => ({
        extension: row.extname,
        schema: row.schema_name,
        installed: row.extversion,
        availableDefault: row.default_version,
      })));
      console.table(REQUIRED_PLANNER_STATISTICS.map((required) => {
        const row = plannerStats.get(required.name);
        return {
          statistics: required.name,
          table: row ? `${row.table_schema}.${row.table_name}` : "missing",
          kinds: Array.isArray(row?.kinds) ? row.kinds.join("") : "",
          columns: Array.isArray(row?.columns) ? row.columns.join(",") : "",
          target: Number(row?.statistics_target ?? 0),
          populated: Boolean(row?.populated),
        };
      }));

      const indexUsage = await client.query(
        `SELECT
           indexrelname,
           idx_scan,
           idx_tup_read,
           idx_tup_fetch,
           pg_relation_size(indexrelid) AS size_bytes
         FROM pg_stat_user_indexes
         WHERE schemaname = 'public'
           AND indexrelname = ANY($1::text[])
         ORDER BY pg_relation_size(indexrelid) DESC, indexrelname`,
        [REQUIRED_INDEXES],
      );
      console.table(indexUsage.rows.map((row) => ({
        index: row.indexrelname,
        method: indexes.get(row.indexrelname)?.access_method ?? "?",
        scans: Number(row.idx_scan ?? 0),
        tuplesRead: Number(row.idx_tup_read ?? 0),
        tuplesFetched: Number(row.idx_tup_fetch ?? 0),
        sizeMiB: (Number(row.size_bytes ?? 0) / (1024 * 1024)).toFixed(2),
      })));
    }
  }
} finally {
  await client.end().catch(() => {});
}
