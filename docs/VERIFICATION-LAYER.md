# AgentRanking Verification Layer (KYA — Know Your Agent)

**Audience:** investors, compliance reviewers, and partner diligence teams  
**Status:** Phase 2 — account-level KYC + KYA oracle (mock/Persona adapters)  
**Version:** 1.1

---

## Account-level KYC (primary product verification)

AgentRanking accounts (`AppAccount`) complete **individual KYC once** via a swappable provider adapter (default: **Persona** in production, **mock** in dev).

- Verification attaches to the **account**, not per-agent.
- All owned agents **inherit** verified status automatically.
- Public credential: opaque `AR-XXXXXXXX` public id — **no PII** in our database or public APIs.
- Webhook-driven status updates (`inquiry.approved`, etc.) — frontend callbacks are not trusted.
- Card issuance on `/dashboard/card` is gated on account verification; basic treasury/wallet remains available unverified.
- Dev bypass: `KYC_DEV_BYPASS=true` (non-production only).

Env: `VERIFICATION_ENABLED`, `KYC_PROVIDER`, `PERSONA_*`, `CARD_ISSUANCE_ENABLED`.

---

## Overview and problem statement

AgentRanking indexes 163k+ AI agents across chains. As agents begin to hold wallets, earn revenue, and request payment instruments (cards), counterparties need a trustworthy signal:

> *Is this agent who it claims to be, and how risky is it to extend spend limits to it?*

The **Verification Layer** answers that question. It issues an **Agent Passport** and an **Agent Risk Tier** based on on-chain and operational evidence — not human identity documents.

Card program partners can call a public **Oracle** endpoint to read an agent’s risk tier and recommended daily spend limit. AgentRanking acts as a **data / risk vendor**. We are not the regulated card issuer, and we do not become the customer of record for identity KYC of individual operators.

---

## Compliance model (entity / sub-cardholder)

Plain-language model:

1. A **regulated card program entity** (the issuer / program manager partner) holds the **verified business account**. That entity is responsible for its own KYC/KYB of the *business* under applicable law.
2. Individual **agent operators do not submit personal identity documents to AgentRanking**.
3. AgentRanking **never stores PII** (no names, government IDs, selfies, addresses, or tax IDs in our database).
4. We verify **agents** (wallets, on-chain history, declared endpoints, sanctions exposure, platform reputation) — **not humans**.
5. Our product output is an **Agent Risk Tier** that the card program may use to set **spend limits** and eligibility. The card program remains the decision-maker and regulated party.

If a future partner requires identity retrieval, that happens via a `providerRef` against a KYC provider adapter — **never** through AgentRanking’s data store.

---

## What KYA verifies vs what it does NOT do

### Verifies (Know Your Agent)

| Signal | Purpose |
|--------|---------|
| Wallet ownership proof | Cryptographic signature that a wallet controls the agent claim |
| On-chain age & activity | Longevity and transaction patterns |
| Counterparty diversity | Breadth of interaction graph |
| Endpoint liveness | Declared x402 / MCP endpoints respond |
| Capability consistency | Declared capabilities match observed behavior |
| Sanctions / denylist screening | Exposure to flagged addresses (hard fail) |
| Platform reputation | Existing AgentRanking scores |
| Delegation | One operator passport can authorize additional agent wallets under scoped permissions |

### Explicitly does NOT do

- Collect or store personal identity documents
- Perform consumer KYC on behalf of operators
- Issue cards itself
- Act as a bank, money transmitter, or regulated card issuer
- Guarantee that a partner will approve any agent
- Replace the partner’s own compliance program

---

## Architecture (full flow)

```
 Operator                     AgentRanking                         Partners (swappable)
 ────────                     ────────────                         ───────────────────
    |                              |                                      |
    | 1. Select agent              |                                      |
    | 2. Sign ownership message    |                                      |
    |----------------------------->| OwnershipProof + Passport PENDING    |
    |                              |                                      |
    |                              | 3. Risk engine (0–100 + factors)     |
    |                              |    + sanctions screener (adapter)    |
    |                              | Passport ACTIVE + RiskAssessment     |
    |                              |                                      |
    | 4. (Optional) Delegate       | AgentDelegation                      |
    |----------------------------->|                                      |
    |                              |                                      |
    |                              | 5. Oracle GET /api/oracle/agent-risk |
    |                              |------------------------------------->| Card issuer adapter
    |                              |    riskTier, score, limit advice     | checkEligibility()
    |                              |                                      |
    |                              | 6. Continuous rescreen (cron)        |
    |                              |    suspend / expire / tier change    |
    |                              |                                      |
    |                              | [Phase 2] CardIssuer.requestCard?    |
    |                              | [Phase 3] anchorPassport() on-chain  |
```

All external KYC and card-issuer systems sit behind **provider-agnostic adapters**. Partner names are **never** hardcoded into schema, routes, or domain types. Selection is via environment config only.

---

## Adapter interfaces

### `KycProvider`

Hosted verification sessions for partners that need a KYC hop **outside** AgentRanking’s data store. We persist only status + opaque `providerRef` — never PII.

```ts
interface KycProvider {
  name: string;
  createSession(params: {
    referenceId: string;
    callbackUrl: string;
  }): Promise<{ sessionId: string; url: string }>;
  getStatus(sessionId: string): Promise<{
    status: "pending" | "approved" | "rejected" | "expired";
    providerRef: string;
    completedAt?: Date;
  }>;
  verifyWebhook(payload: unknown, signature: string): boolean;
}
```

### `CardIssuer`

Eligibility and (Phase 2) card request. Core logic only sees risk tier / score / wallet.

```ts
interface CardIssuer {
  name: string;
  supportsAgentCards: boolean;
  checkEligibility(params: {
    agentWallet: string;
    riskTier: RiskTier;
    riskScore: number;
  }): Promise<{
    eligible: boolean;
    maxDailyLimitUsd: number;
    reasons: string[];
  }>;
  requestCard?(params: unknown): Promise<unknown>; // Phase 2
}
```

**Config:** `KYC_PROVIDER=mock|civic`, `CARD_ISSUER=mock|partner`  
Application code imports providers only from the factory (`src/lib/verification/providers`).

---

## Data model reference

No PII fields. Enums and models (Prisma):

| Model | Role |
|-------|------|
| `AgentPassport` | Canonical agent credential: status, risk tier/score, hash, optional Phase 3 `anchorTx` |
| `OwnershipProof` | Signed ownership evidence (message + signature + consumed nonce) |
| `OwnershipChallenge` | Short-lived nonce for ownership (and related) signing challenges |
| `AgentDelegation` | Scoped authority from a parent passport to another agent wallet |
| `RiskAssessment` | Versioned score breakdown (`factors` JSON, `assessorVersion`) |
| `VerificationEvent` | Audit trail: created, screened, tier_changed, suspended, revoked, reinstated |

**Statuses:** `PENDING` \| `ACTIVE` \| `SUSPENDED` \| `REVOKED` \| `EXPIRED`  
**Tiers:** `UNRATED` \| `BASIC` \| `STANDARD` \| `ELEVATED` \| `PRIVILEGED`

`passportHash` = SHA-256 of a canonical JSON record (for future on-chain anchoring).

---

## API reference

### `POST /api/verification/challenge`

Body: `{ agentId, walletAddress, chain }`  
Returns the exact message to sign and a nonce (10-minute expiry).

### `POST /api/verification/verify-ownership`

Body: `{ agentId, walletAddress, chain, signature, nonce }`  
Verifies Solana (nacl) or EVM (viem) signature, matches known owner wallet when available, creates `OwnershipProof` + `AgentPassport` (`PENDING`), then runs risk assessment toward `ACTIVE` (unless sanctions hard-fail → `SUSPENDED`).

### `POST /api/verification/assess`

Body: `{ passportId }`  
Recomputes risk score / tier (idempotent rescreen helper).

### `POST /api/verification/delegate`

Body: `{ parentPassportId, delegatedAgentId, delegatedWallet, signature, scopes, nonce }`  
Parent passport must be `ACTIVE`; signature must be from `ownerWallet`.

### `POST /api/verification/revoke-delegation`

Body: `{ delegationId, parentPassportId, signature, nonce }`  
Sets `active=false`, `revokedAt=now`.

### `GET /api/oracle/agent-risk?wallet={address}`

**Public product oracle.** Cached ~60s. Returns wallet, passport summary, agent summary, factor breakdown **without raw chain dumps**, issuer recommendation, attestation hash. **Never returns PII.**

### `GET /api/cron/verification-rescreen`

Authenticated internal cron. Re-screens `ACTIVE` passports older than 24h; handles sanctions, tier changes, expiry.

---

## Risk tiers and scoring methodology

Score range **0–100**. Algorithm version stored as `assessorVersion` (currently `1.0.0`).

| Factor | Max pts | Notes |
|--------|---------|-------|
| ownershipProven | 25 | Signature verified |
| onchainAgeDays | 15 | 0d→0, 30d→5, 90d→10, 365d+→15 |
| transactionHistory | 15 | Count + volume, log scale |
| counterpartyDiversity | 10 | Unique counterparties |
| endpointLiveness | 10 | Declared endpoint responds |
| capabilityDeclaration | 10 | Declared vs observed consistency |
| sanctionsScreening | 10 | Clean screen; **hard fail → score 0 + SUSPENDED** |
| platformReputation | 5 | Existing AgentRanking reputation |

**Tier mapping**

| Score | Tier |
|-------|------|
| 0–19 | UNRATED |
| 20–39 | BASIC |
| 40–59 | STANDARD |
| 60–79 | ELEVATED |
| 80–100 | PRIVILEGED |

Mock issuer maps tiers to illustrative daily USD limits (configurable via env). Real partner rules live only in the issuer adapter.

---

## Revocation and continuous monitoring

- Default passport validity: **365 days** (`PASSPORT_VALIDITY_DAYS`, env-configurable).
- Daily rescreen of ACTIVE passports with `lastScreenedAt` older than 24h.
- Sanctions hit → `SUSPENDED` + `VerificationEvent`.
- Tier change → `VerificationEvent` (`tier_changed`).
- Past `expiresAt` → `EXPIRED`.
- Explicit revoke path sets `REVOKED` + reason.
- Delegation revoke sets `active=false` without necessarily revoking the parent passport.

---

## Open questions

| Topic | Status |
|-------|--------|
| Card issuer partner | TBD (candidates exist; **not confirmed** — adapter only) |
| KYC provider | TBD (candidates exist; **not confirmed** — adapter only) |
| Jurisdiction / program structure | TBD with partner counsel |
| Exact spend-limit policy tables | Partner-owned; mock tables for demo only |
| On-chain anchoring chain / program | Phase 3 TBD |
| Relationship to existing directory “premium verify” product | Complementary; passport risk tier is the card-eligibility signal |

---

## Phased roadmap

### Phase 1 — Demo (this branch)

- Spec, schema, adapters (mock + stubs)
- Ownership proof, risk engine, oracle, delegation
- Continuous rescreen cron route
- Investor demo UI at `/verify`
- Tests for signatures, scoring, oracle no-PII contract, provider factory

### Phase 2 — Partner integration

- Wire real `KycProvider` / `CardIssuer` via config
- `requestCard` implementation behind adapter
- Partner-specific eligibility rules without core changes

### Phase 3 — On-chain anchoring

- Populate `anchorTx` via stubbed `anchorPassport()`
- Anchor `passportHash` for public attestations
- Anchor program **not** built in Phase 1

---

## Design principles (non-negotiable)

1. **No PII in schema or API responses.**
2. **No partner brand names** in schema, routes, or domain types.
3. **Every partner-specific value in env**, never hardcoded in core logic.
4. **Additive only** — does not alter main’s critical path.
5. AgentRanking is a **risk/data vendor**, not the regulated entity.
