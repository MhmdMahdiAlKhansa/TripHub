# Requirements Traceability

## Source documents
| Source | Status | Authority |
|---|---|---|
| `TripHub_Codex_Master_Prompt.md` (marketplace spec) | Read | Authoritative |
| Pasted "Trip Management SaaS" spec | Read | **Superseded** by user decision (2026-11-07). Used only as a source of supplementary rules (see DECISIONS D-02) |
| Challenge / scope-lock / project brief documents | **Unavailable** – none found in workspace | n/a. If supplied later, they outrank this prompt and this file must be re-run |

Repository state at inspection: empty (no files, no git). Toolchain: Node 24.21, npm 11.19, Docker 29.8, git 2.55. Missing: pnpm, psql (will be provisioned via corepack / Docker).

## Mapping (status: Planned until implemented; "Tests" column names the suite in TEST_STRATEGY.md)
| ID | Requirement (spec section) | Implementation target | Phase | Tests |
|---|---|---|---|---|
| R-01 | Repo inspection, preserve code | This file | 0 | n/a |
| R-02 | Planning docs + single approval | `docs/*` | 0 | n/a |
| R-03 | Modular monolith, strict TS, migrations, seeds | all apps | 1 | CI |
| R-04 | Brand/design system, RTL, dark mode | `packages/ui`, `apps/web` | 1 | a11y, RTL visual |
| R-05 | Public pages (home, companies, listings, SEO, blog) | `apps/web` | 2 | E2E, SEO |
| R-06 | Auth: email/pw, Google, MFA, sessions, step-up | `apps/api/auth` | 1 | integ, security |
| R-07 | Multi-company membership, RBAC, invitations, last-owner guard | `apps/api/tenancy` | 1–2 | isolation |
| R-08 | Business onboarding + verification + suspension | `apps/api/companies` | 2 | E2E |
| R-09 | Unified Listing model, 4 booking modes, pricing modes | `apps/api/listings` | 2–3 | unit, integ |
| R-10 | Server-side quote + immutable snapshot | `apps/api/booking/pricing` | 3 | unit, property |
| R-11 | Separate state machines (booking/hold/payment/refund/payout) | `packages/shared/state` | 3 | transition-table tests |
| R-12 | Holds, atomic capacity, idempotency, waitlist | `apps/api/booking` | 3 | race sim |
| R-13 | Business ops: calendar, export, reschedule, QR check-in | api+web | 3 | E2E |
| R-14 | Manual payments, proof = unverified evidence | `apps/api/payments` | 3 | truthfulness |
| R-15 | Double-entry ledger, commissions, reconciliation | `apps/api/ledger` | 3 | invariants |
| R-16 | Refunds, disputes, payouts, separation of duties | api | 3 | integ |
| R-17 | Plans, add-ons, billing state machine, trial lifecycle | `apps/api/billing` | 4 | lifecycle |
| R-18 | Customer profile, favorites, collections, reviews | api+web | 4 | E2E |
| R-19 | Maps abstraction, nearby search, FX (USD/LBP) | api+web | 4 | unit |
| R-20 | AI gateway, routing, credits wallet, governance | `apps/api/ai`, worker | 5 | credit races |
| R-21 | AI privacy: redaction, consent, retention 7d | `ai/privacy` | 5 | privacy |
| R-22 | Marketing: promos, campaigns, referrals, gift cards | api | 5 | integ |
| R-23 | Email + in-app notifications, outbox, true statuses | worker | 5 | provider-failure |
| R-24 | CMS, SEO, hreflang, sitemaps | web+api | 2/5 | SEO |
| R-25 | Support tickets/disputes | api | 3/6 | integ |
| R-26 | Admin console, analytics reconciled to ledger | web+api | 6 | reconcile |
| R-27 | Security gates, threat model, backups | infra, docs | 6 | scans, drills |
| R-28 | Load/concurrency/a11y tests, runbooks, launch checklist | tests, docs | 6 | all |
