# Delivery Plan

Each slice = migration + rules + REST/OpenAPI + UI + authz + worker jobs + observability + tests + docs. A slice is done only when its tests pass; progress tracked in `docs/PROGRESS.md`. No public launch until all phases and gates pass (internal staging allowed).

| Phase | Slices | Exit gate |
|---|---|---|
| **1 Foundation** | 1.1 monorepo/CI/Docker Compose/env · 1.2 DB baseline, audit, idempotency · 1.3 auth (pw, verify email, Google, reset, sessions, MFA, step-up) · 1.4 tenancy guards + tenant-isolation test harness · 1.5 i18n/RTL + design system + logo + dark mode · 1.6 observability | `pnpm verify` green; isolation harness running in CI |
| **2 Companies & listings** | 2.1 company onboarding + uploads · 2.2 verification workflow · 2.3 team/RBAC/invites · 2.4 category forms, listings, media, translations · 2.5 CMS + public pages + SEO + featured companies · 2.6 search (FTS, AR normalization) | Publish gating works; SEO tests pass |
| **3 Booking & finance** | 3.1 availability/slots · 3.2 pricing/quote · 3.3 holds/capacity/idempotency · 3.4 booking state machines · 3.5 waitlist · 3.6 manual payments + proofs · 3.7 ledger/commission · 3.8 refunds/disputes · 3.9 payouts · 3.10 QR check-in/calendar/export | Race sims 0 overbooking; ledger invariants hold |
| **4 Subscriptions & customer** | 4.1 plans/entitlements/add-ons · 4.2 billing state machine, trial, grace, invoices · 4.3 FX/currency · 4.4 customer profile, favorites, collections, reviews · 4.5 maps/nearby | Trial/expiry lifecycle tests |
| **5 AI & growth** | 5.1 gateway/registry/routing · 5.2 credits wallet · 5.3 privacy/consent/redaction/retention · 5.4 customer AI search · 5.5 business AI tools + approval queue · 5.6 marketing/promos/referrals/gift cards · 5.7 notifications · 5.8 analytics | Credit race tests; AI privacy tests |
| **6 Production readiness** | 6.1 admin console completion · 6.2 hardening, security scan, pen checklist · 6.3 a11y/RTL audit · 6.4 load tests · 6.5 backup/restore drill · 6.6 staging/prod IaC, runbooks, incident response · 6.7 acceptance report | All launch gates in ACCEPTANCE_CHECKLIST |

Working pattern after approval: run autonomously slice by slice; interrupt only for true external blockers (credentials, legal, provider contracts).
