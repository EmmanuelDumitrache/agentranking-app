# Agent Payments — Treasury & Card Architecture

**Branch:** `feat/agent-payments`  
**Status:** Lithic + USDC ledger (mock dev / Helio funding + Lithic production path)

---

## Product model

- Each **user account** (`AppAccount`) has **one USDC treasury wallet** and **at most one payment card**.
- Agents **do not own cards**. They spend from the account treasury/card under **spending policies**.
- AgentRanking is the orchestration layer. Card issuance and funding providers are **swappable adapters**.

```
User (AppAccount)
  → TreasuryWallet (USDC ledger)
  → PaymentCard (tokenized; no PAN/CVV)
  → Agents (spend via policy engine)
```

---

## What we kept vs what is new

| System | Fate |
|--------|------|
| Helio product orders (KYA, boosts, ads) | **Kept** — marketplace purchases, not treasury |
| Custodial Solana/EVM wallets | **Kept** — launches / on-chain ops at `/dashboard/wallet` |
| LLM credit deposits | **Kept** — chat billing rail |
| USDC balance + virtual card | **New** — `/dashboard/card` + `/api/wallet|cards|policies` |

---

## Modules

| Service | Responsibility |
|---------|----------------|
| Wallet Service | deposit, withdraw, reserve, release, spend |
| Treasury Service | bootstrap wallet + policy for AppAccount |
| Funding Service | createFundingIntent, confirmFunding, syncBalance |
| Card Service | issue / freeze / unfreeze / cancel / details |
| Spending Policy Service | limits, categories, agent/manual toggles |
| Spend Service | agent spend() with policy middleware |
| Transaction Service | queryable ledger |
| Audit Service | every sensitive action |
| Agent Service | account agents + spend summaries |

---

## Provider adapters (no vendor lock-in)

```
FUNDING_PROVIDER=mock|helio|hosted
CARD_ISSUER_PROVIDER=mock|partner|stripe-bridge|stripe-issuing|crossmint|lithic|marqeta
CARD_ISSUER=mock|partner|stripe-bridge|stripe-issuing|crossmint|lithic|marqeta
```

Interfaces: `PaymentProvider`, `CardIssuerProvider`, `WalletProvider`  
Factory: `src/lib/agent-payments/providers/index.ts`  
App code **never** imports Stripe/Bridge/Rain/Lithic SDKs directly.

---

## API

| Method | Path |
|--------|------|
| POST | `/api/wallet/fund` |
| GET | `/api/wallet/balance` |
| GET | `/api/wallet/transactions` |
| GET | `/api/wallet/agents` |
| POST | `/api/cards/issue` |
| POST | `/api/cards/freeze` |
| POST | `/api/cards/unfreeze` |
| GET | `/api/cards` |
| GET | `/api/cards/details` (isolated reveal) |
| POST | `/api/treasury/agents/:agentId/spend` |
| GET | `/api/treasury/agents/:agentId/transactions` |
| GET/POST | `/api/policies` |

Auth: dashboard session. Rate-limited. Audited.

---

## Frontend

- `/dashboard/card` — balance dashboard
- `/dashboard/card/manage` — card dashboard + reveal placeholder
- `/dashboard/card/agents` — agent spend activity + simulator
- `/dashboard/card/transactions` — filtered ledger
- `/dashboard/card/settings` — spending policies

Sidebar: **Card** → card section. **Wallet** remains custodial on-chain wallets.

---

## Card issuance

Default flow: pick an agent, pay the issuance fee from your USDC card balance, then the account card is issued. One card per account; agents spend under policy.

| Env | Purpose |
|-----|---------|
| `CARD_ISSUANCE_FEE_CENTS` | One-time fee in cents (default `2500` = $25) |
| `CARD_ISSUANCE_DEV_BYPASS=true` | Waives fee in non-production only |

`POST /api/cards/issue` requires `agentId`. Returns `402` when balance is below the fee.

### Stripe + Bridge stablecoin cards (preview scaffold)

Adapter: `StripeBridgeIssuer` (`CARD_ISSUER_PROVIDER=stripe-bridge`). Private preview — no live Stripe API calls yet.

- Commercial cards: Bridge business customer → Stripe Connect subaccount → agent cardholders
- JIT spend from Privy (`crypto_wallet.type=standard`) or Bridge custodial wallet (`bridge_wallet`)
- Real-time auth: `POST /api/webhooks/stripe/issuing-authorization` → `handleAuthorizationWebhook()` (oracle + policy plug-in)

Docs: [Stripe stablecoin cards](https://docs.stripe.com/issuing/stablecoin-cards), [Bridge integration](https://docs.stripe.com/issuing/bridge-stablecoin-cards)

### Stripe Issuing — fiat balance (test mode)

Adapter: `StripeIssuingStandard` (`CARD_ISSUER_PROVIDER=stripe-issuing`). Uses standard Stripe Issuing with platform fiat balance — **not** Bridge/Privy stablecoin flow.

- One virtual card per **agent** (`AgentIssuingCard` model)
- Cardholder: `POST /v1/issuing/cardholders` (`type=individual`, `metadata.agent_id`)
- Card: virtual with daily `spending_limits` from risk tier (`CARD_ISSUER_TIER_LIMITS_JSON`)
- Real-time auth: `POST /api/webhooks/stripe/issuing-authorization` → oracle tier check + same-day spend rollup (no dev bypass)
- Test balance: `POST /api/stripe/issuing/top-up` (non-production)
- Sandbox UI: `/dashboard/card/stripe-test`

| Method | Path |
|--------|------|
| POST | `/api/stripe/issuing/agents/:agentId/issue` |
| GET | `/api/stripe/issuing/agents/:agentId` |
| POST | `/api/stripe/issuing/agents/:agentId/simulate` |
| POST | `/api/stripe/issuing/top-up` |

Env: `STRIPE_SECRET_KEY=sk_test_…`, `STRIPE_WEBHOOK_SECRET=whsec_…`

### Crossmint agent wallets + agent cards

Adapter: `CrossmintIssuer` (`CARD_ISSUER_PROVIDER=crossmint`). Staging API — separate from Stripe.

**Two Crossmint products (per public docs):**

| Path | API | Funding | Merchant spend |
|------|-----|---------|----------------|
| **Agent Wallets** | `POST /api/2025-06-09/wallets` | Onramp UI → USDC in wallet, or `stagingFund` | On-chain (x402 / MPP) — not card rails |
| **Agent Cards** | `POST /api/unstable/order-intents` | User's enrolled Visa/MC (`paymentMethodId`) | Merchant-scoped credentials via order intent |

**Not** a single headless "stablecoin balance → virtual card at any merchant" API in public docs. Agent Cards charge saved cards (US Visa eligibility rules apply). Stablecoin path is wallet + on-chain.

**Authorization:** No Stripe-style `issuing_authorization.request`. Agent Cards use mandates at creation; wallets use `wallets.transfer.in/out` webhooks (Svix).

| Method | Path |
|--------|------|
| POST | `/api/webhooks/crossmint` |

Env: `CROSSMINT_PROJECT_ID`, `CROSSMINT_SERVER_API_KEY`, `CROSSMINT_CLIENT_API_KEY`, optional `CROSSMINT_SERVER_SIGNER_ADDRESS` + `CROSSMINT_SIGNER_SECRET` for wallet creation.

### Lithic virtual cards + agent stablecoin ledger

Adapter: `LithicIssuer` (`CARD_ISSUER_PROVIDER=lithic`). Sandbox API — separate from Stripe/Crossmint.

**Architecture:** fund `AgentStablecoinLedger` (USDC cents per agent) → `POST /v1/cards` virtual card per agent → Lithic ASA POSTs each auth to our webhook → oracle tier limits + ledger balance → `{"result":"APPROVED"}` or decline within ~6s.

| Method | Path |
|--------|------|
| POST | `/api/webhooks/lithic/asa` |

Env: `LITHIC_API_KEY`, `LITHIC_ASA_WEBHOOK_SECRET`, optional `LITHIC_ENVIRONMENT=sandbox`.

### Marqeta virtual cards + agent stablecoin ledger

Adapter: `MarqetaIssuer` (`CARD_ISSUER_PROVIDER=marqeta`). Sandbox API — separate from Lithic/Stripe/Crossmint.

**Architecture:** fund shared `AgentStablecoinLedger` → `POST /users` + `POST /cards` per agent → Marqeta Gateway JIT POSTs each auth → oracle tier limits + ledger balance → HTTP `200` + `jit_funding` body (approve) or `402` (decline).

| Method | Path |
|--------|------|
| POST | `/api/webhooks/marqeta/jit-funding` |
| POST | `/api/webhooks/marqeta/events` |

Env: `MARQETA_APPLICATION_TOKEN`, `MARQETA_ADMIN_ACCESS_TOKEN`, `MARQETA_CARD_PRODUCT_TOKEN`, `MARQETA_JIT_GATEWAY_USERNAME` / `MARQETA_JIT_GATEWAY_PASSWORD`, optional `MARQETA_WEBHOOK_USERNAME` / `MARQETA_WEBHOOK_PASSWORD` / `MARQETA_WEBHOOK_SECRET`.

Sandbox setup (program gateway + events webhook + card product JIT):

```bash
node scripts/setup-marqeta-sandbox.mjs
```

Production checklist:

1. Marqeta sales onboarding + KYB (AU operator — request international program)
2. `MARQETA_API_BASE_URL=https://api.marqeta.com/v3` + production tokens
3. `MARQETA_WEBHOOK_BASE_URL=https://app.agentranking.io` then re-run setup script
4. `CARD_ISSUANCE_DEV_BYPASS=false`
5. Deploy app so both webhook routes return 200 (not 404)

---

- Never store PAN/CVV — only `providerCardId` + last four
- Never expose provider secrets to the client
- Role/ownership checks on agent spend
- Idempotency keys on fund/spend
- Audit log for issue/freeze/spend/policy

---

## Future phases (designed for)

Agent sub-wallets, multi-card, card rotation, physical cards, cross-chain funding, Privy, Stripe/Bridge/Rain, autonomous purchasing, A2A payments, merchant allow/deny lists, subscriptions, payroll.
