# Decision Log

| ID | Decision | Rationale |
|---|---|---|
| D-01 | Follow the marketplace spec (user choice, 2026-11-07). | User-selected. |
| D-02 | Adopt useful rules from the superseded SaaS spec: confirmed booking reserves capacity independent of payment (for non-hold modes); strict FIFO waitlist with whole-group promotion and no skipping; single-use, time-limited, term-bound approval links for material booking changes with optimistic `version`; Asia/Beirut scheduling over UTC storage; 24h reminders; AI mutations require preview + explicit confirmation + idempotency + audit; AI daily message limits (guest 10 / customer 40 / business 100). | Compatible with marketplace spec; strengthens it. Marketplace spec wins on conflict. |
| D-03 | Monorepo with **pnpm workspaces** + Turborepo. | Fast, deterministic; installed via corepack. |
| D-04 | **NestJS 11** (Express adapter) API, **Next.js 15 App Router** web, separate **worker** (BullMQ on Redis). | Spec-mandated split. |
| D-05 | PostgreSQL 16 + **Prisma**; raw SQL migrations for constraints Prisma can't express (exclusion/check constraints, partial indexes). | Capacity and ledger integrity enforced in DB. |
| D-06 | **No RLS in v1**; tenant scoping via mandatory `companyId` repository layer + DB FKs + cross-tenant tests. RLS re-evaluated after verifying PgBouncer transaction pooling behavior. | Spec says "optional, carefully tested". |
| D-07 | Auth: custom NestJS module (argon2id, httpOnly secure session cookies stored server-side in Postgres/Redis, TOTP MFA, Google OIDC with PKCE). Not JWT-in-localStorage. | Revocable sessions, device management. |
| D-08 | Money: `NUMERIC(18,4)` / Prisma `Decimal`, integer minor units in ledger; currency on every row; no float. | Correctness. |
| D-09 | Ledger: append-only journal, each entry set sums to zero per currency, enforced by deferred constraint trigger; corrections via reversing entries. | Immutability. |
| D-10 | Hold maximum 30 minutes (platform cap), default 15. Capacity via `SELECT … FOR UPDATE` on slot row + `reserved_count` guarded by CHECK (`reserved <= capacity`). | Prevents overbooking even if app bug. |
| D-11 | Commission applies to eligible booking value (excl. taxes, platform fees, gift-card-funded portions per config); rate snapshotted. Free-trial commission default **10%**, disclosed before activation. Annual discount 15% (config, not a commitment). | Spec left trial value configurable. |
| D-12 | Phase-1 funds: platform-collected, manually settled; feature flag `custody_payments` **off in production until legal sign-off**. | Spec legal caution. |
| D-13 | AI: provider registry (Gemini adapter, OpenAI adapter, Mock). Models configured in DB/admin, never hard-coded. Credits: 1 credit ≈ fixed internal cost unit, calibrated post-eval; ledger with reserve→settle→refund. | Spec. |
| D-14 | Storage: S3-compatible (MinIO local, R2/S3 prod); public and private buckets; ClamAV for scanning (container). | Spec. |
| D-15 | Email via adapter (SMTP/Mailpit local; Resend or SES prod, chosen at deploy). Delivery status only from provider callbacks. | Truthful statuses. |
| D-16 | Maps: provider abstraction, MapLibre + OSM tiles default; geocoding provider optional/flagged (cost control). | Cost. |
| D-17 | Hosting: Docker images; Compose locally; production on single-region VPS/container platform (Fly.io/Render/Hetzner) + managed Postgres + R2 + CDN. IaC via Terraform for the minimum footprint only. | Affordable, no k8s. |
| D-18 | Search: Postgres FTS + trigram (pg_trgm) with Arabic normalization; no external search engine in v1. | Simplicity. |
| D-19 | i18n: next-intl, logical CSS properties, `dir` set per locale; translation completeness check in CI. | RTL correctness. |
| D-20 | Trial activation window 14 days after approval; one trial per verified business/beneficial-owner hash. | Spec. |
| D-21 | Overdue subscription grace 7 days; existing bookings remain manageable, new bookings blocked after grace. | Spec. |
| D-22 | AI raw prompt/output retention 7 days max, none for flows touching sensitive data. | Spec. |
| D-23 | Seed data labeled `DEMO`; demo passwords only in non-production seed, guarded by env check. | Spec. |
| D-24 | Pinned NestJS 11.2.8 (not 12.x) and Prisma 7.10.1 (latest tag is an rc). Revisit upgrades after launch gates. | Avoid unknown breaking changes in a 12.x major / rc. |
| D-25 | pnpm build scripts allowlisted explicitly (`allowBuilds`); telemetry/optional native scripts denied. | Supply-chain hygiene. |
| D-26 | Feature flags (`payments`, `requestToBook`) live in code behind a DI token with default OFF; only tests override them. Not env-driven. | A misconfigured env must not enable real-money or unfinished flows. |
| D-27 | Capacity: a single `reserved` counter on the slot (confirmed + held seats) updated by one conditional UPDATE; the booking status transition is the only gate that releases seats. | Simple, provably consistent, race-tested. |
| D-28 | Request-to-book will NOT hold seats while pending; capacity is checked atomically on approval. | Avoids indefinite holds beyond the 30-minute platform cap. |
| D-29 | Waitlist offers hold seats in `slot.reserved` for 60 minutes (capped at slot start); strict FIFO with no skipping of a head that does not fit. | Keeps the capacity invariant simple and overbooking impossible. The 60-minute window is a product assumption awaiting owner confirmation. |
| D-30 | Selling (publishing, accepting new bookings) requires an entitled subscription; the free trial is the normal start. Trials convert only through an explicit business request fulfilled by platform finance after a verified manual payment (separate person, not a member of the business). Status is derived from dates, so enforcement never depends on the worker. | Spec: trials never auto-convert, 7-day grace, existing bookings stay manageable. |
| D-31 | Cancellation policy tiers (customer-initiated): FLEXIBLE full refund >=24h before; MODERATE (default) full >=72h, 50% >=24h; STRICT 50% >=7d; NON_REFUNDABLE none. A business cancellation is always a full refund. Percentages are initial assumptions awaiting owner confirmation, snapshotted per booking. | Spec requires a policy per experience, shown before payment and snapshotted; exact terms were not specified. |
