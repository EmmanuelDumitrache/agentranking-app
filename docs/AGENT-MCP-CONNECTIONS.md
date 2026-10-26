# Agent MCP connections

AgentRanking’s MCP runtime uses reusable, account-owned remote connections and explicit per-agent bindings. This is the only execution architecture: indexed `AgentService` records remain public discovery data and are not credentials, runtime connections, or an execution authority.

## Product model

An `AgentMcpConnection` owns the remote endpoint, transport, encrypted credential, validated catalog, health, and circuit state for one dashboard account. An `AgentMcpBinding` independently assigns that connection to an agent and owns approval and call limits. Sparse `AgentMcpToolPolicy` rows override one tool for one binding. Two agents may therefore share a connection while enabling different tools and policies; disabling or removing one binding does not affect the other.

The dashboard surfaces this model in two places:

- `/dashboard/connections` creates, verifies, reconnects, disables, refreshes, and deletes account connections.
- An agent’s Connections tab assigns those account connections, changes per-agent limits, and reviews tool schemas and quarantine state.

The account wizard groups reviewed Web3 providers by capability, derives endpoint/authentication controls only from server manifests, and keeps API keys/tokens in password inputs that are cleared after submission. Existing write-only credentials are never loaded back into a form; rotation begins through an explicit Replace action. Agent rows expose account details, verification, recovery, catalog refresh, removal, and an accessible assignment switch. Optimistic failures restore only the changed item, while verification, discovery, reauthentication, disablement, and credential changes invalidate only cached agent lists that reference the affected connection.

Deleting a connection with bindings returns a conflict and an affected-agent list. The user must explicitly detach those agents. Binding creation and deletion serialize on the connection row, and deletion repeats the in-use check inside its transaction, so a concurrent assignment cannot escape that decision. Soft deletion removes active bindings, credentials, OAuth transactions, and continuations; redacted audit history remains attributable through nullable foreign keys. After that authoritative local transaction succeeds, its already-authorized in-memory credential snapshot is used for a five-second, SSRF-hardened, best-effort RFC 7009 token-revocation attempt. This ordering prevents a concurrent-assignment conflict from revoking a connection that remains live, while provider failure still cannot undo local deletion.

## Admitted providers

The executable registry is `src/features/agent-chat/server/mcp/provider-registry.ts`, with the expanded first-party catalog in `provider-manifests.ts`. Every manifest is validated during module initialization. The manifest records provider and publisher identity, exact endpoint/origin, transport, authentication, chains, categories, capability classes, risk level, billing model, credential fields, server-side allowlist support, confirmation requirements, lifecycle stage, review date, first-party evidence, and publisher-controlled brand metadata. New connections are admitted only for a remote, fixed/template provider in `REMOTE_LAUNCH` or `REMOTE_BETA`, with publisher-controlled evidence for publisher, endpoint, transport, authentication, tools, and chain coverage.

Capability classes are `Read Only`, `Analytics Query`, `Simulation`, `Transaction Prep`, `Wallet Approval`, `Trading`, `Paid Calls`, and `Account Admin`; a provider can declare more than one. These are catalog-level disclosures. Actual permission remains tool-level: live discovery creates one classified descriptor per tool and every agent binding may disable it, raise its approval mode, constrain input, cap calls, or acknowledge a changed schema independently.

| Catalog group | Providers | Posture |
|---|---|---|
| Core data | Nansen, Dune, DefiLlama, Bitquery, Token Terminal, Messari, LunarCrush, Pyth, Zerion, Ankr Agent RPC, SQD Portal, Chainbase | Read-only or bounded analytics; provider plan costs still apply |
| Specialized data | Allium AgentHub, CryptoQuant, Tenderly, Santiment, Glassnode, QuickNode, Alchemy | Read/analytics plus separately classified simulation or account-administration tools |
| Complementary market data | CoinMarketCap, CoinGecko | Read-side market data; CoinGecko selects its keyless or Pro origin from the chosen auth mode |
| Execution and wallets | LI.FI, thirdweb, Jupiter, OKX Onchain OS, 1inch, Base, Morpho, Yield.xyz AgentKit, OpenSea | Every privileged call confirms; unsigned preparation/trading may proceed, while generic signing, broadcast, payment, and custody remain blocked |
| Visible watchlist | Fireblocks AI Link, Binance Agent OS | Catalog cards are visible but disabled until a stable public endpoint and the remaining admission/risk review exist |

Morpho is connectable but visibly marked experimental/pre-v1.0. CryptoQuant and Glassnode are marked beta. Fireblocks AI Link is early access and Binance Agent OS is watchlist/high risk; neither gets an invented endpoint. BNB Chain's local `npx` server, the local-only OKX CEX Agent Trade Kit, and GoPlus's current local/installable surface are deliberately excluded from executable reviewed connections. The UI shows all maintained catalog entries, supports search and capability/risk/lifecycle filters, and gives unavailable entries an explicit reason instead of silently hiding them.

The registry records the evidence URL and review date. Every claim required for launch must have publisher-controlled evidence checked within the last 180 days; stale evidence automatically removes the provider from new one-click setup without breaking existing saved connections. A saved non-custom provider whose manifest is removed fails closed at both policy evaluation and the transport constructor rather than silently inheriting the custom-server posture; explicit custom connections are identified only by a null provider key. Public provider DTOs intentionally omit evidence internals, allowed origins, token endpoints, OAuth issuers, and curated risk matchers. Local-only packages are not connectable: supporting those requires a separate isolated, per-tenant gateway design and must never execute packages in the web process.

Custom remote servers are explicitly labeled unreviewed. They require a public HTTPS endpoint, use the same network controls, default unclassifiable tools to `UNKNOWN`, and quarantine unreviewed financial/signing behavior.

The documentation link, legal links when published, evidence claims, review date, and official icon URL live with each manifest rather than in a second hand-maintained list.

## Credentials and OAuth

All secret material is server-only and encrypted with the application secret envelope. Configure `APPLICATION_SECRET_ENCRYPTION_KEY` or the rotation form `APPLICATION_SECRET_KEYS`, keeping old keys available for decryption until every envelope has been rotated. Browser caches and response DTOs receive only an authentication kind, configured flag, masked fingerprint suffix, reauthentication state, and best-effort OAuth expiry.

Supported modes are none, bearer token, reviewed API-key header, reviewed API-key query injection, reviewed API-key tool-argument injection, OAuth authorization code with PKCE, and OAuth client credentials. For catalog providers, the server ignores browser-supplied placement names/header names/prefixes and uses the manifest value. Custom connections cannot select query or tool-argument injection. Custom header names pass an authority/cookie/forwarding/platform-header denylist and all names and values reject control characters.

The two special API-key placements exist only for first-party protocols that require them. thirdweb's `secretKey` is encrypted and added to a temporary outbound URL only after the stored secret-free endpoint passes exact-origin validation; redirects are forbidden while the query credential is present, and redaction recognizes `secretKey`. Zerion's key is removed from the model-visible catalog schema and injected into the reviewed argument only after the live tool authorization check. Exact stored secret values are also scrubbed if a provider echoes one in catalog metadata or a tool result. The model input, approval payload, hashes, audits, continuations, catalog, connection endpoint, and dashboard DTO all remain secret-free.

Authorization-code state is random and stored only as a hash. The continuation is bound to account, connection, redirect URI, MCP resource audience, transport, expiry, and optional return agent. Starts are connection-single-flight, take the connection lifecycle lock, and replace older unconsumed state so a PKCE verifier cannot be paired with a competing browser flow or outlive a concurrent deletion/auth rotation. An explicit Reconnect first rotates the encrypted OAuth principal, clears pending callbacks and resumable calls, invalidates its catalog/cache partition, and best-effort revokes the previous token before starting a fresh browser grant. The callback atomically marks state consumed before token exchange, so replay cannot reuse it. Curated authorization URLs remain on the reviewed issuer origin; reviewed scopes and token endpoints are pinned against SDK discovery and returned token metadata. Initial token issuance and later refreshes are recorded as account/connection-scoped audit and operational events; the success audit row commits in the same transaction as the encrypted token update.

Client credentials require an exact, reviewed public-HTTPS token endpoint and expected issuer. The MCP SDK receives the expected issuer, and AgentRanking checks the actual token URL again immediately before allowing client authentication to add the secret. Legacy client-credential envelopes lack that pinning and are migrated to `REAUTH_REQUIRED`; the user must re-enter the credential.

The implementation follows the MCP authorization specification and client-credentials extension:

- [MCP authorization](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)
- [OAuth client credentials extension](https://modelcontextprotocol.io/extensions/auth/oauth-client-credentials)

## Endpoint and transport boundary

Stored production connections must be public HTTPS URLs without user information, fragments, or endpoint query parameters. The one reviewed query-auth mode adds its credential only to the ephemeral outbound request URL and rejects redirects. OAuth endpoints may contain protocol query parameters but still require public HTTPS. Fixed provider URLs and auth-selected endpoint variants must match exactly; template manifests constrain hostname suffixes.

Every MCP and OAuth request uses the hardened outbound transport:

- URL parsing and IDN normalization happen before use; IDNA round-trip failures, invisible/bidirectional controls, mixed numeral systems, and ambiguous mixed-script labels are rejected using a conservative UTS #39-style profile.
- IPv4/IPv6 loopback, private, link-local, reserved, documentation, metadata, multicast, transition, and mapped-private addresses are rejected.
- DNS resolves all answers and rejects the hostname if any answer is non-public.
- The validated address is installed in the socket lookup callback, closing the validate-then-re-resolve gap.
- Redirects are manual, capped, and revalidated at every hop. Requests with bodies are not replayed. Authenticated cross-origin redirects fail; unauthenticated cross-origin redirects retain only an explicit safe-header allowlist.
- Connect, discovery, invocation, OAuth token, header, request, response, schema, page, and catalog bounds are enforced.

There is no private-network escape hatch: local, loopback, link-local, reserved, and private destinations remain unavailable in every environment.

Streamable HTTP is preferred. `AUTO` behavior falls back only between transports permitted by the manifest/custom connection and only for deterministic protocol incompatibility (for example, unsupported method/content type). Authentication failures and server failures do not trigger transport fallback. Mutation, trade, and payment calls are never automatically retried.

## Lifecycle and catalog behavior

The connection lifecycle is `DRAFT/AUTH_PENDING → VERIFYING → READY`, with `DEGRADED`, `REAUTH_REQUIRED`, `INVALID`, `BLOCKED`, `DISABLED`, and `DELETED` recovery/terminal states. Global suspension also has an authoritative `disabledAt` marker so it can coexist with `BLOCKED`, `REAUTH_REQUIRED`, or `INVALID`; re-enabling clears only that marker and cannot erase the recovery requirement. Verification initializes the MCP session, negotiates protocol/transport, discovers the bounded catalog, classifies every tool locally, saves the catalog and descriptor rows atomically, and only then marks the connection ready.

Catalog identity includes endpoint, credential principal fingerprint, provider key/manifest version, negotiated server identity, and executable tool descriptors. Description-only changes do not change a tool schema hash. Schema, manifest, server identity, or local risk-classification changes increment the connection revision. Every add/change/remove emits an atomic per-tool audit record containing hashes and trusted classification flags, never the untrusted description or schema body. A previously observed higher risk remains sticky across refreshes; material changes and removals clear per-binding acknowledgements and quarantine the affected descriptor. Removed tools remain historical descriptors marked inactive and quarantined. A failed refresh preserves the last good catalog and makes an existing connection degraded instead of erasing usable state.

Catalog persistence is compare-and-swap protected: discovery commits only against the exact connection version and lifecycle state it started with. A concurrent credential edit, global disable, security block, reauthentication requirement, or deletion rolls the descriptor/catalog transaction back instead of allowing a late network result to revive the connection. A normal retry cannot clear `BLOCKED`; administrator force-refresh is the explicit successful recovery action.

Credential writes, binding creation, continuation persistence, and deletion share a connection-first row-lock order. Standalone OAuth SDK reads and writes additionally prove the current auth mode and the exact credential-principal fingerprint under lock, preventing late callbacks or old pooled clients from inheriting a replacement authorization context or recreating credentials after rotation or soft deletion. Administrator-forced reauthentication first commits its versioned local authority revocation, catalog expiry, OAuth-state removal, and continuation removal, then attempts bounded upstream token revocation from the authorized snapshot; a stale admin command therefore cannot revoke a connection whose local compare-and-swap failed.

The worker runs scheduled catalog maintenance hourly. Connections whose manifest version changed are prioritized, followed by aged catalogs with stable jitter. User verification/discovery and scheduled refresh use distributed single-flight leases.

## Runtime and approval policy

The chat runtime queries enabled `AgentMcpBinding` rows only. It never joins `AgentService`. Missing/rejected curated identities and `BLOCK_ALL` bindings contribute no model-visible tools. It loads a durable catalog without connecting, creates stable namespaced tool aliases, and opens a remote client lazily on first use. One provider’s malformed catalog, connection failure, timeout, or circuit opening produces a scoped chat warning and does not abort the agent, transcript, or other providers.

Before every network call, the runtime re-reads and validates account/agent/binding ownership, connection state, current provider-manifest revision, current descriptor and schema hash, platform rules, quarantine acknowledgement, sparse tool policy, input constraints, call quotas, concurrency, timeout, circuit state, and approval mode. A shipped manifest revision immediately makes its prior catalog ineligible until bounded rediscovery applies the new reviewed policy. Execution correlates the current tool-call ID with the SDK’s validated approval request/response history; tightening approval policy after tools were loaded therefore fails with a fresh-approval requirement instead of running under stale metadata. Every locally declared state-changing wallet tool also requires a separate SDK approval over its exact native input, so an approved MCP quote or transaction builder never inherits signing or broadcast authority. Process bulkheads independently cap the account, shared connection, and exact binding, so one agent’s chosen parallelism does not become another agent’s connection-wide policy. The account/run/tool/connection quota decision is one atomic distributed operation, so a rejected call cannot partially consume unrelated quota buckets. Input-required continuations are single-use encrypted capabilities relationally and cryptographically bound to the same account, agent, connection, binding, descriptor, exact schema hash, and original approval state; resumption re-enters the same authorization, approval, quota, concurrency, output-validation, circuit, audit, and native-transaction pipeline. Continuation persistence serializes against connection and binding lifecycle mutations and proves that both remain executable, so an in-flight response cannot recreate authority after disable. Disabling/removing a binding, globally suspending a connection, changing its endpoint/transport/credential principal, forcing reauthentication, or deleting the connection permanently removes affected pending continuations. Server tool descriptions, instructions, schemas, prompt results, and outputs remain untrusted external data and never enter the system/developer instruction channel.

Approval precedence is platform block, connection/ownership, provider/tool admission, binding, sparse policy/schema acknowledgement, effective risk, conversation approval, then native wallet policy. `AUTO_READ_ONLY` auto-runs only reads (and bounded analytics); `CONFIRM_MUTATIONS` confirms non-read actions; `CONFIRM_EVERY_CALL` confirms every call; `BLOCK_ALL` contributes no callable tools. Hard-blocked generic risks are `SIGN`, `BROADCAST`, `PAYMENT`, and `CUSTODY`.

## Web3 safety boundary

MCP never receives a private key, mnemonic, seed, raw signing key, wallet export, or decrypted custody credential. A schema requesting such material is classified as custody, quarantined, and blocked. Provider annotations can raise but never lower locally inferred risk.

Quote/price/route retrieval without transaction material is read-only. Calldata, unsigned transaction requests, token approvals, transaction mutation fields, or builders classify as `TRANSACTION_PREPARE`; an actual swap/bridge/order action classifies as `TRADE`. Generic signing, broadcast, payment/x402, and custody tools are blocked.

For a recognized EVM unsigned request, AgentRanking validates a positive chain ID, exact destination address, hex calldata, and non-negative transaction value; extracts chain, destination, asset/amount, value, operation, slippage/minimum output, bridge destination, fee, deadline, signer, method selector, calldata hash, and token approval; and creates a canonical review hash covering the raw intent plus every review field. ERC-20 unlimited approvals are decoded and blocked by default. Signed, secret-bearing, opaque, structurally invalid, and unsupported payloads are blocked without returning raw intent.

An eligible result is only an `unsigned_transaction_requires_native_review` handoff. It explicitly records that simulation and fresh human approval are required and that the MCP path has neither signed nor broadcast. Any subsequent native wallet action is a separate state-changing tool call, bound to its exact arguments and existing native wallet approval/idempotency policy. MCP output alone is never signing authority.

## APIs

All mutation routes require an authenticated dashboard account, same-origin request, tenant ownership, strict non-empty request schema, and mutation rate limit. Composite database foreign keys additionally prevent a sparse tool policy from pairing a binding with a descriptor from a different connection. Connection creation requires a UUID idempotency key; credential replacement rejects fields from a different auth mode and requires each encrypted credential tuple to be replaced atomically. If a response is interrupted after the connection row or encrypted credential commits, retrying the same request resumes the remaining setup, verification, discovery, and optional assignment without overwriting an already-committed write-only credential.

- `GET /api/dashboard/mcp/providers`
- `GET|POST /api/dashboard/mcp/connections`
- `GET|PATCH|DELETE /api/dashboard/mcp/connections/:connectionId`
- `POST /api/dashboard/mcp/connections/:connectionId/verify`
- `POST /api/dashboard/mcp/connections/:connectionId/discover`
- `POST /api/dashboard/mcp/connections/:connectionId/oauth/start`
- `GET /api/dashboard/mcp/connections/:connectionId/oauth/callback`
- `GET /api/dashboard/agents/:agentId/mcp-bindings`
- `PUT|DELETE /api/dashboard/agents/:agentId/mcp-bindings/:connectionId`
- `GET /api/dashboard/agents/:agentId/mcp-bindings/:connectionId/tools`
- `PATCH /api/dashboard/agents/:agentId/mcp-bindings/:connectionId/tools/:toolId`

The provider catalog GET endpoint supports `admission`, `category`, `chainFamily`, `capability`, `riskLevel`, `releaseStage`, `priority`, `connectable`, and free-text `search` filters. Filtering never turns a non-admitted entry into a connectable one.

Connection and binding updates use optimistic versions (`If-Match` or `expectedVersion`). `If-Match` accepts exactly one quoted positive safe-integer version (optionally weak); a malformed value or a conflicting body version fails closed. A repeated binding PUT with identical effective values is idempotent and does not increment the version. An idempotency key may replay connection creation only when all structural parameters still match.

## Operations and incident response

The admin MCP Operations page lists health/status counts, enabled binding/tool counts, provider/origin, catalog age, failures, and targeted rules. New-connection rules can target global scope, provider key, origin, or account; runtime blocks and quarantines can additionally target an exact existing connection, tool glob, or risk class. Tool/risk quarantine rules require review. Provider/origin incidents therefore do not require deleting user configuration.

Emergency environment controls (truthy values are `1`, `true`, `yes`, or `on`):

| Variable | Effect |
|---|---|
| `MCP_RUNTIME_DISABLED` | Removes all MCP runtime tools; ordinary chat continues. |
| `MCP_NEW_CONNECTIONS_DISABLED` | Blocks all new connection creation. |
| `MCP_CUSTOM_SERVERS_DISABLED` | Blocks new custom servers. |
| `MCP_TRANSACTION_PREPARE_DISABLED` | Blocks transaction-preparation tools. |
| `MCP_FINANCIAL_TOOLS_DISABLED` | Blocks preparation, trade, sign, broadcast, payment, and custody risks. |
| `MCP_SCHEDULED_DISCOVERY_DISABLED` | Stops scheduled catalog discovery. |

Circuit tuning is available through `MCP_CIRCUIT_FAILURE_THRESHOLD`, `MCP_CIRCUIT_FAILURE_WINDOW_MS`, and `MCP_CIRCUIT_COOLDOWN_MS`. Defaults are documented in `.env.example`. The circuit fast-fails repeated transient provider errors, permits one half-open recovery probe, closes on success, and moves authentication-required, 401/403, invalid-token, revoked-token, and expired-token failures directly to reauthentication instead of counting them as transient provider outages.

Prometheus metrics are `mcp_operations_total`, `mcp_operation_duration_seconds`, `mcp_unsigned_transaction_intents_total`, `mcp_events_total`, `mcp_tool_bytes`, `mcp_catalog_changes_total`, `mcp_connections`, `mcp_enabled_bindings`, and `mcp_catalog_tools`. Traces use bounded IDs/status/risk/transport attributes and never include endpoints with query data, credentials, raw inputs, or raw outputs. Audit rows store safe lifecycle metadata and hashes, not secret values or raw calldata.

### Recovery guide

| State/symptom | Operator or user action |
|---|---|
| `REAUTH_REQUIRED` | Reconnect OAuth or rotate/re-enter the credential. Legacy client credentials must also supply exact token endpoint and issuer. |
| `DEGRADED` with cached tools | Provider calls may still be attempted behind the circuit. Verify/discover after provider recovery; the last good catalog remains. |
| `INVALID` | Review the stable reason code, endpoint/auth settings, then verify. |
| `BLOCKED` | Fix the endpoint/network cause or remove the matching admin rule, then use administrator force-refresh (or force reauthentication). A normal user retry cannot clear the block. |
| `DISABLED` or a `Globally disabled` badge | Re-enable globally. Assignments/policies remain saved. A simultaneous block, invalid configuration, or reauthentication requirement remains visible and must be recovered separately. Admin force-refresh preserves account suspension. |
| Tool quarantined/schema changed | Review the current exact schema hash and risk, then acknowledge it for that agent binding. |
| Connection in use on delete | Review the affected-agent list and explicitly detach, or keep the shared connection. |
| Inline chat warning | Open Dashboard → Connections using the recovery link. The current chat and other providers remain usable. |

## Migration notes

Migration `20260825010000_account_mcp_connections` is a one-way cutover with no dual-write period. It proves every legacy service/agent/account relationship, creates exactly one originating-agent binding per old relationship, verifies total and enabled counts, preserves credential ciphertext/envelope fields byte-for-byte, checks same-account ownership, quarantines migrated tool descriptors for local reclassification, marks unpinned legacy client credentials for reauthentication, and only then drops legacy service/agent columns and enums. Migration `20260826090000_web3_mcp_provider_credentials` adds the two reviewed secret-placement modes without changing existing connection records. Because the preserved AES-GCM envelopes bind the legacy auth-mode spelling in their authenticated data, reads try the current spelling first and then its exact legacy equivalent; every new write uses only the current spelling. Keep every referenced legacy encryption key in `APPLICATION_SECRET_KEYS` until those credentials have been replaced or rewritten. Legacy continuation ciphertext is deliberately revoked because it predates exact binding and descriptor/schema capability identity; new continuation rows have a composite foreign key proving the same account, agent, connection, and binding. Legacy endpoint values are preserved only when they are canonical HTTPS URLs without userinfo, query data, or fragments. Every other value is replaced with a non-routable placeholder, blocked, and must be explicitly re-entered through the current endpoint validator so legacy query credentials cannot leak into endpoint metadata.

The migration intentionally does not auto-share a legacy connection with other agents. Users can assign the resulting account connection after cutover. `AgentService` deletion has no effect on the connection runtime.

## Maintainer map

- Persistence and lifecycle: `repository.ts`, `connection-service.ts`, `configuration.ts`, `binding-repository.ts`
- Provider/admission/auth/network: `provider-registry.ts`, `provider-manifests.ts`, `credentials.ts`, `endpoint-policy.ts`, `network.ts`, `client-factory.ts`
- Catalog/risk/policy: `catalog-validation.ts`, `catalog.ts`, `risk.ts`, `policy-service.ts`, `platform-policy.ts`
- Runtime/safety: `runtime-manager.ts`, `client-pool.ts`, `tool-adapter.ts`, `transaction-boundary.ts`
- Dashboard/API DTOs: `dashboard-dto.ts`, dashboard MCP route tree, and the two MCP dashboard components
- Reliability/operations: `reliability.ts`, `observability.ts`, `audit.ts`, worker catalog refresh, and admin MCP Operations

The test artifacts under `src/features/agent-chat/server/mcp/__tests__` encode the migration, provider, credential, OAuth, network, catalog, binding, runtime, UI, and Web3 boundaries. They are designed to be run through the repository’s existing MCP test command during a normal validation pass.
