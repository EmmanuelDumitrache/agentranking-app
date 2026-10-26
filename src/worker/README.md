# Worker runtime

The production background process is compiled from `src/worker/main.ts` to `dist/worker/main.mjs`.

`src/jobs` is the application-facing queue boundary: queue names, payload contracts, producer functions, pg-boss lifecycle, and shared lease constants. Next.js code may import that boundary, but must not import `src/worker`.

`src/worker/application` owns application pg-boss consumers and schedules. `src/worker/indexer` owns chain indexing, synchronization, indexer queues, and commands. The worker does not expose an HTTP diagnostics or metrics server.

`pnpm dev` runs the TypeScript worker in watch mode beside Next.js. `pnpm dev:build` applies Prisma migrations, builds the production artifacts, runs the compiled worker's exclusive pg-boss schema and queue-policy migration, and then starts the compiled worker beside the standalone web server. Build the worker alone with `pnpm run worker:build`, type-check it with `pnpm run typecheck:worker`, or start an existing production bundle with `pnpm run start:worker`.


Production startup keeps pg-boss auto-migration disabled. While both PM2 runtimes are stopped, deployment runs the staged worker with `--migrate-pg-boss <release-id>` to upgrade the pg-boss-owned schema, create or update the application and indexer queues, and verify their actual definitions before starting the release.
