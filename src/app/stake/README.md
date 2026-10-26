# Stake product

The staking experience is implemented under this directory and served at the root of the dedicated staking host. The `/stake` route is an internal application mount; requests to `stake.agentranking.io/` are rewritten to it without exposing the internal path.

## Structure

- `page.tsx` — internal route entry and metadata.
- `components/` — product sections and staking composition.
- `dashboard/` — staking dashboard presentation components.
- `integrations/` — Streamflow transaction integration.
- `primitives/` — reusable staking display primitives.
- `shell/` — dedicated staking-site navigation and footer.
- `styles/` — route-specific CSS modules.
- `assets/` — source assets mirrored into the public asset tree when needed.

Runtime staking logic is canonical in shared application modules rather than duplicated here:

- `src/app/stake/integrations/streamflow-stake-form.tsx`
- `src/app/stake/integrations/staking-error-boundary.tsx`
- `src/components/streamflow/streamflow-solana-wallet-root.tsx`
- `src/lib/staking-*.ts`
- `src/lib/streamflow-*.ts`
- `src/lib/ar-*.ts`

Keeping one runtime implementation prevents the dedicated staking product and shared application services from drifting.

## Local development

```bash
pnpm dev
```

Open `http://localhost:3000/stake`.

The pool-creation utility remains available at `http://localhost:3000/internal/staking/setup` when its development gate is enabled.

## Required public configuration

```env
NEXT_PUBLIC_STREAMFLOW_STAKE_POOL=
NEXT_PUBLIC_STREAMFLOW_STAKE_POOL_MINT=
NEXT_PUBLIC_AR_SOLANA_MINT=
```