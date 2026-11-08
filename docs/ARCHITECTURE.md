# Architecture

## Topology
```
Browser ─► CDN/Reverse proxy (TLS) ─┬─► apps/web (Next.js, SSR public SEO + dashboards)
                                    └─► apps/api (NestJS REST, OpenAPI) ──► PostgreSQL
                                              │                       ├──► Redis (queues, rate limit, cache)
                                              │                       └──► S3 (public / private buckets)
apps/worker (BullMQ consumers + schedulers) ──► same Postgres/Redis; providers: email, AI, maps, scanning
```
Web calls API through a generated typed OpenAPI client; browser never talks to DB. Session cookie is set by API on a shared parent domain (or proxied under `/api`).

## Modules (apps/api) – modular monolith, no cross-module DB access except via module services
`auth` · `users` · `companies` (onboarding, verification, media) · `tenancy` (memberships, roles, permissions, invitations) · `listings` · `availability` · `pricing` · `booking` (holds, capacity, waitlist, changes) · `payments` · `ledger` · `refunds` · `payouts` · `disputes/support` · `billing` (plans, add-ons, trials, invoices) · `ai` (gateway, routing, credits, privacy) · `marketing` · `notifications` · `reviews` · `content` (CMS) · `search` · `fx` · `maps` · `analytics` · `admin` · `audit` · `files`.

Layering inside each module: controller (DTO validation, authz guard) → service (business rules, transactions) → repository (tenant-scoped Prisma access). Domain events written to a transactional outbox; worker publishes/consumes.

## Cross-cutting
- **AuthZ:** `AuthGuard` → `TenantGuard` (resolves company from membership, never from client-trusted ID alone) → `PermissionGuard` (deny-by-default, permission strings like `booking.refund.approve`). Step-up and MFA policies per permission.
- **Idempotency:** `Idempotency-Key` header required on money/booking mutations; table stores key, request hash, response; same key + different payload → 409.
- **Audit:** append-only `audit_event` (actor, company, action, entity, before/after hash, request id, ip hash).
- **Errors:** RFC 7807-style problem+json with stable codes; no DB error leakage.
- **Observability:** pino JSON logs with redaction, OpenTelemetry traces, Prometheus metrics, health/readiness endpoints, correlation IDs.

## Key domain models (summary)
`Listing(kind, bookingMode, pricingMode, companyId, status)` → `Offering/Slot(capacity, reserved, startsAt)` → `Booking(version, snapshot JSON immutable, status)` ↔ `Hold(expiresAt)` ↔ `Payment(status, evidence[])` ↔ `LedgerEntry/Journal` ↔ `Refund` ↔ `Payout`. `Company ─< Membership >─ User`; `Subscription`, `Entitlement`, `AddOn`; `AiCreditLot` (earliest-expiry-first) + `AiCreditLedger`; `CreditReservation`.

## State machines (full transition tables in packages/shared/state, tested exhaustively)
- **Booking:** DRAFT → HELD → PENDING_APPROVAL | PENDING_PAYMENT → CONFIRMED → (RESCHEDULED→CONFIRMED) → COMPLETED | CANCELLED | NO_SHOW; HELD → EXPIRED; WAITLISTED → OFFERED → HELD|EXPIRED. REQUESTED → APPROVED|REJECTED.
- **Hold:** ACTIVE → CONSUMED | EXPIRED | RELEASED.
- **Payment:** INITIATED → PROOF_SUBMITTED (unverified) → VERIFIED | REJECTED; VERIFIED → PARTIALLY_REFUNDED | REFUNDED; FAILED/VOID.
- **Refund:** REQUESTED → APPROVED → TRANSFER_RECORDED → COMPLETED (only after verified transfer) | REJECTED | FAILED.
- **Payout:** SCHEDULED → APPROVED → TRANSFER_RECORDED → COMPLETED (verified) | FAILED | CANCELLED.
- **Subscription:** TRIAL_ELIGIBLE → TRIAL_PENDING_ACTIVATION → TRIAL_ACTIVE → (consent) ACTIVE | TRIAL_EXPIRED; ACTIVE → PAST_DUE(grace 7d) → SUSPENDED → CANCELLED; ACTIVE → CANCEL_AT_PERIOD_END.

## Concurrency strategy
1. Hold/book transaction: lock slot row (`FOR UPDATE`), check `capacity - reserved - activeHolds >= qty`, increment, insert hold; DB CHECK as backstop.
2. Release on expiry/cancel via worker + lazy check at read; idempotent.
3. Waitlist promotion: single worker queue per slot (advisory lock `pg_advisory_xact_lock(slotId)`), strict FIFO.
4. Credits/ledger: reservations by `SELECT … FOR UPDATE` on lots; unique idempotency keys.

## Deployment
Docker images for web/api/worker; Compose (postgres, redis, minio, mailpit, clamav, caddy) locally; CI builds, tests, scans, pushes images; staging then production with migration step (`prisma migrate deploy`) gated before rollout; backups with PITR + monthly restore drill.
