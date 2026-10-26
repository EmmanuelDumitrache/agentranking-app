# Client/server ownership

This document defines the ownership contract for the AgentRanking Next.js App Router application. It applies to every new file and every file touched during the client/server migration.

## Core rule

Server Components own the first meaningful route result whenever the data is available from request state, PostgreSQL, internal services, or server-to-server APIs without a browser-only identity. Client Components own interaction state, browser APIs, connected wallets, signatures, streaming, optimistic mutations, and bounded refresh after a server-provided snapshot.

A route must not render an avoidable client loading state while an effect requests data that the Server Component could have loaded during the same request.

## Route ownership

Server Components own:

- route `params` and first-render `searchParams` parsing;
- secure authentication and authorisation;
- Prisma/PostgreSQL reads;
- private environment variables and credentials;
- server-to-server RPC and HTTP reads;
- initial lists, detail records, summaries, configuration, options, and non-interactive calculations;
- success, empty, not-found, and access-denied first-render states;
- conversion to deliberately selected serialisable DTOs.

Client Components own:

- event handlers and local form state;
- open, selected, expanded, drag, focus, and transient UI state;
- DOM, storage, media, file, canvas, and injected-provider APIs;
- connected-wallet identity and signatures;
- browser transaction construction, signing, and submission;
- chat streaming, cancellation, tool rendering, and in-flight run state;
- optimistic mutations and post-mutation refresh;
- interaction-triggered search and hover-card reads;
- bounded polling that starts from a server snapshot;
- state that cannot exist before hydration.

## Internal data access

A Server Component must not call this application's own `/api/...` route over HTTP. Shared reads use a server-only domain reader or DAL:

```text
Server page/layout  ─┐
                     ├─> domain *.server.ts reader ─> database/RPC/external API
Route handler       ─┘
```

Route handlers remain transport adapters. They parse HTTP input, call the shared reader, and serialise the response. Mutations may remain Route Handlers until a separate migration explicitly changes them.

## DTO boundary

Values passed from a Server Component to a Client Component must be plain serialisable DTOs:

- primitives, arrays, and plain objects only;
- dates converted to ISO strings or bounded epoch numbers;
- `BigInt` and decimal values converted to intentional strings or numbers;
- no Prisma model instances or broad relation results;
- no functions, class instances, `Request`, `Response`, `Error`, wallet clients, or secrets;
- no sensitive fields merely because the route is authenticated.

## Provider placement

The root runtime contains only the global error boundary, chunk-load recovery, and one toast container.

Provider scopes are:

- public query routes: `PublicQueryProviders`;
- public follow/profile routes: `PublicSessionProviders`;
- public browser-wallet routes: `AuthWalletProviders`, which owns the TanStack Query boundary required internally by Wagmi and RainbowKit;
- authenticated dashboard workspace: `DashboardWorkspaceProviders` containing NextAuth, TanStack Query, Privy, and dashboard Wagmi;
- admin portal: `AdminPortalProviders` containing TanStack Query while existing portal queries remain;
- dashboard and admin authentication route groups: no workspace or portal providers.

`src/app/(public-site)/public-site-layout-client.tsx` currently selects the narrow public provider bundle by route using `src/lib/public-site/provider-scope.json` as the single route-classification source. Wallet routes do not receive a second public QueryProvider because their wallet boundary already owns one. Domain migrations should move providers still deeper when a route can isolate them around one client island.

## Route-group structure

Dashboard URLs are preserved through pathless groups:

```text
src/app/dashboard/
  layout.tsx
  (auth)/auth/**
  (workspace)/**
```

The `(auth)` subtree does not initialise workspace authentication data, Privy, dashboard Wagmi, TanStack Query, prices, account summaries, or owned-agent data. The `(workspace)` layout owns those providers and the authenticated shell.

Agent memory follows the same boundary:

- `dashboard/(workspace)/agents/[agentDbId]/memory/page.tsx` authorises the owner and server-loads settings, active facts, pending facts, and summary counts;
- the client memory page owns explicit settings/fact mutations and user-triggered refresh only;
- chat completion attempts a durable queue enqueue before request teardown;
- the worker owns bounded, idempotent extraction after a completed and settled run;
- memory reads never provision profiles, accounts, wallets, settings, or facts;
- automatically extracted facts require approval by default and enter prompts only after activation;
- prompt memory is treated as untrusted data and is bounded by both fact count and total characters.

Admin URLs are preserved through:

```text
src/app/admin/
  layout.tsx
  (auth)/login/**
  (portal)/**
```

The login subtree does not mount portal chrome, heartbeat, or TanStack Query. The portal layout owns them.

## `useAsyncResource` server seeding

`useAsyncResource` accepts:

```ts
type Options<T> = {
  initialData?: T | null;
  initialDataKey?: string | null;
  revalidateOnMount?: boolean;
  keepPreviousData?: boolean;
};
```

When `initialDataKey` equals the current `key`, the initial value is the current loaded snapshot. `loading` is false on first render. `revalidateOnMount: false` performs no mount request. `revalidateOnMount: true` retains the initial value while refreshing in the background. A changed key loads normally, `refresh()` always creates a new request revision, and stale requests remain abortable.

Callers must provide `initialDataKey` explicitly; `initialData` without a matching key remains only a display fallback and preserves the old request behaviour.

## TanStack Query initial data

Existing queries that continue after hydration must use the same parameter normalisation and query key on the server and client. Simple queries receive `initialData` and `initialDataUpdatedAt`. Infinite queries receive the exact `{ pages, pageParams }` shape expected by the hook. Server timestamps determine whether an immediate refresh is warranted. Query-key and freshness-policy standardisation are separate migration steps.

## File conventions

- `*.server.ts` and `*.server.tsx`: server-only reads or server composition;
- `*-client.tsx` or `client/`: client entrypoints;
- `shared/`: pure serialisable types and functions that import neither runtime side;
- touched DAL/private-environment modules import `server-only`;
- Route Handlers are not the sole location of reusable read logic.

## Automated enforcement

`pnpm run verify:ownership` runs `scripts/verify-client-server-ownership.mjs`. `pnpm run check:source` runs it before type checking and ESLint.

The verifier rejects:

- client imports of database, Prisma, Next server APIs, Node built-ins, or transitive server-only modules;
- DAL/server-runtime imports of client entrypoints;
- new client `page.tsx` or `layout.tsx` entries without a reviewed exception;
- Server Components that fetch the application’s own `/api` routes instead of calling an owned server reader;
- server page/layout reads that call `ensureMinimalUserProfile` and therefore create profile state during rendering;
- request Dynamic APIs in the root layout;
- retired `RequestHostProvider`, `useRequestHost`, and synthetic `x-pathname` routing;
- client modules whose `useEffect` callback graph reaches `fetch` without a reviewed mount-loader classification;
- public pages whose reachable client graph uses TanStack Query, Wagmi/RainbowKit, or `useSession` without a matching provider scope.

Every exception in `scripts/client-server-ownership-allowlist.json` records a path, reason, owner, and removal condition. Broad undocumented exceptions are prohibited.
