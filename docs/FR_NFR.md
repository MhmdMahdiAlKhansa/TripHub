# TripHub (Trip Desk): functional and non-functional requirements, one page

Brief: SE-NEXT SaaS Challenge, "Trip Desk: bookings for hiking and tour operators" (Standard). Pilot user: a small Lebanese
tour operator or hiking club that sells trips on Instagram and counts seats in direct messages.

## Functional requirements (what version one must do)

| # | Requirement | Where it lives | Proof |
|---|---|---|---|
| FR-1 | An operator signs up, creates a business workspace, and gets verified by platform staff before publishing. | `companies`, `admin` modules | `companies.test.ts`, `admin.test.ts` |
| FR-2 | Publish trips with dates, capacity, price (USD or LBP) and pickup points. | `listings`, `booking/availability` | `listings.test.ts`, `deposits.test.ts` (pickup) |
| FR-3 | Stop bookings at capacity; several people booking the last seats at once never overbook. | `packages/database/capacity.ts`, `bookings.service.ts` | `booking.test.ts`, `stress.test.ts`, load test (150 for 100 seats) |
| FR-4 | Open a strict first-come waitlist when a date is full; a freed seat is offered to the head of the queue for a limited time. | `waitlist.service.ts`, `packages/database/waitlist.ts` | `waitlist.test.ts` |
| FR-5 | Track each participant's deposit, paid to the operator by Whish, OMT or cash; the seat is confirmed when the deposit lands and released to the waitlist if it never does. | `booking/deposits.service.ts` | `deposits.test.ts` |
| FR-6 | Keep a participant list with contact phone, pickup point and emergency contact; export it as CSV. | `booking.controllers.ts`, `tickets.service.ts` | `deposits.test.ts`, `tickets.test.ts` |
| FR-7 | Send a reminder the day before the trip (in-app + email). | `packages/database/reminders.ts`, worker job, email outbox | `deposits.test.ts` (reminder), `outbox.test.ts` |
| FR-8 | Check participants in at the door with an unforgeable ticket code, exactly once. | `tickets.service.ts` | `tickets.test.ts`, load test (60 scans) |
| FR-9 | Two sides, several roles: customer; business owner / manager / booking staff / finance; platform support / verifier / finance / admin, each with its own desk. | `tenancy`, `admin`, web `BusinessDesk`, `AdminConsole` | `tenancy.test.ts`, `roles.spec.ts` |
| FR-10 | One business can never read another's data. | `TenantGuard`, company-scoped queries | `tenancy.test.ts` (isolation), `business.spec.ts` |
| FR-11 | English and Arabic (RTL) throughout. | `apps/web/src/messages`, `dir=rtl` | `i18n.test.ts`, `public.spec.ts` |

Out of scope for version one (documented in `docs/PROGRESS.md` NOT DONE lists): platform-custody online payments (built, flagged off), AI features, SMS, payouts to banks.

## Non-functional requirements

| # | Requirement | How it is met | Evidence |
|---|---|---|---|
| NFR-1 Correctness under concurrency | Seats are reserved with row-level locks inside one transaction; holds expire atomically; idempotency keys on booking creation. | 150 simultaneous bookings for 100 seats sell exactly 100 (`docs/LOAD_TESTS.md`). |
| NFR-2 Security | argon2id passwords, server-side sessions in HttpOnly cookies, Origin CSRF check, TOTP two-step for staff, rate limits, security headers + CSP, step-up re-auth for sensitive actions, per-route zod validation. | `auth.test.ts`, `security-headers.test.ts`, `ratelimit.test.ts` |
| NFR-3 Privacy and data minimisation | Only trip-relevant personal data (name, phone, pickup, emergency contact); customers can export and delete (anonymise) their account; photos stripped of EXIF/GPS; append-only audit log. | `privacy.test.ts`, `images.test.ts` |
| NFR-4 Financial integrity | Deposit, ledger, price and invoice tables are append-only (database triggers); money in integer minor units; no floating point. | `baseline.test.ts`, `ledger.test.ts`, `deposits.test.ts` |
| NFR-5 Reliability of email | Durable outbox with retries (1/5/15/60 min) and encrypted payloads; "sent" means accepted by the mail server, never "delivered". | `outbox.test.ts` |
| NFR-6 Performance | Public listing endpoints p99 < 1 s at 40 concurrent connections on one laptop; mobile LCP about 2.2 s under DevTools throttling. | `docs/LOAD_TESTS.md`, Lighthouse runs noted in `docs/PROGRESS.md` |
| NFR-7 Accessibility | axe (WCAG 2 A/AA) runs in the browser suite on public, customer, business and staff pages; keyboard and reduced-motion respected. | `apps/e2e` |
| NFR-8 Observability | Request ids, JSON logs with secret redaction, uniform error envelope, health endpoints. | `observability.test.ts`, `health.test.ts` |
| NFR-9 Deployability | One Docker image for API, worker and web; migrations run on start; CI runs build, typecheck, unit, integration and browser tests on every push and PR. | `Dockerfile`, `.github/workflows/ci.yml` |
| NFR-10 Honesty | Every doc lists what is NOT done; demo data is labelled as demo in docs and uses the reserved `.test` mail domain. | `docs/PROGRESS.md`, `docs/STATUS.md` |

Numbers in this document are measured on a developer laptop unless a source says otherwise; nothing here is a production capacity promise.
