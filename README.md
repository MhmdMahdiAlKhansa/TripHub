# TripHub

Lebanon-first, bilingual (English/Arabic, RTL) multi-tenant discovery and booking marketplace.
**Status: under construction, not launch-ready.** See [docs/PROGRESS.md](docs/PROGRESS.md) for exactly what is
implemented and tested, and [docs/ACCEPTANCE_CHECKLIST.md](docs/ACCEPTANCE_CHECKLIST.md) for the launch gates.

Real payments, email, SMS, AI and maps providers are **not connected**. Anything that would touch real money is
behind code-level feature flags that default to OFF. The dev mailer only logs; it delivers nothing.

## Layout

| Path | What |
|---|---|
| `apps/api` | NestJS REST API (auth, tenancy, companies, listings, booking, payments, admin) |
| `apps/worker` | BullMQ worker (hold expiry runs every minute) |
| `apps/web` | Next.js app (EN/AR, RTL, dark mode) |
| `packages/database` | Prisma schema, SQL migrations (constraints/triggers), capacity helpers |
| `packages/shared` | Domain rules: permissions, state machines, pricing/quotes, ledger postings |
| `packages/ui` | Design-system components and the TripHub logo mark |
| `docs/` | Spec, architecture, decisions, security, test strategy, progress |

## Local setup (Windows/macOS/Linux)

Prerequisites: Node 22+, Docker.

```bash
corepack pnpm install            # (use `pnpm` directly if corepack is enabled)
cp .env.example .env             # then adjust if ports clash
docker compose -f infrastructure/docker-compose.yml up -d postgres redis
corepack pnpm --filter @triphub/database migrate     # apply migrations
```

Default local ports: Postgres `5442`, Redis `6390` (chosen to avoid clashing with other local projects;
edit `infrastructure/docker-compose.yml` and `.env` together if you change them).

## Run

```bash
corepack pnpm --filter @triphub/api dev       # http://localhost:4000/api/v1/health/live, docs at /api/docs
corepack pnpm --filter @triphub/worker dev
corepack pnpm --filter @triphub/web dev       # http://localhost:3000
```

The web app proxies `/api/*` to the API (`API_INTERNAL_URL`, default `http://localhost:4000`). Production-style local run: `build` then `start` for api and web.

## Verify

```bash
for t in build typecheck test; do corepack pnpm -r --workspace-concurrency=1 run $t; done
```

Tests that touch the database need Postgres (and Redis for the rate limiter/worker) running and migrated.
`pnpm verify` uses Turborepo, which needs `pnpm` on your PATH (not just via corepack).

## Local email links

Nothing is emailed. With `DEV_MAILBOX=1` in `.env` (local only; ignored in production) the "sent" verification/reset links appear at http://localhost:3000/en/dev-mailbox.

## Browser tests (Playwright + axe)

Separate from `test` because they need the real servers and demo data running:

```bash
corepack pnpm -r --workspace-concurrency=1 run build
corepack pnpm --filter @triphub/api seed
corepack pnpm --filter @triphub/api start    # terminal 1
corepack pnpm --filter @triphub/web start    # terminal 2
corepack pnpm --filter @triphub/e2e e2e      # uses the system Microsoft Edge (E2E_CHANNEL=chrome for Chrome)
```

## Map

The map shows only when a tile provider is configured. Set `NEXT_PUBLIC_MAP_STYLE_URL` (a MapLibre style JSON URL) and `NEXT_PUBLIC_MAP_ORIGIN` (its tile origin, for the CSP) at build time. For local development without a provider, `apps/web/public/map/dev-style.json` uses OpenStreetMap tiles (not for real traffic). The map browser test runs with `E2E_MAP=1` on such a build.

## Things to know

- Money is always integer minor units (`bigint`); never floating point.
- Booking totals are calculated on the server; the client only sends quantities.
- A payment *proof* is unverified evidence. Only a platform finance user verifying settlement confirms a booking.
- The ledger is append-only and balanced by database triggers.
- Optional local demo data: `corepack pnpm --filter @triphub/api seed` creates a labelled DEMO business, two free listings and two demo accounts (printed by the script). It refuses to run when `NODE_ENV=production`. Nothing else creates default accounts.
