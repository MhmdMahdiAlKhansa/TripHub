# TripHub status: what is done, what is left

Last full verification: 394 automated unit/integration tests passing (shared 140, database 3, API 235, worker 4,
web 12) and 31 real-browser tests passing (Playwright on Microsoft Edge, with axe accessibility checks). Details and
honest "NOT DONE" lists per slice are in `docs/PROGRESS.md`. The GitHub CI workflow has never been run.

## Done (built and tested)

**Platform and security**
- Accounts: register, verify email, sign in, password reset, lockout, rate limits, two-step verification (TOTP +
  recovery codes), password step-up for sensitive actions, session list/revoke.
- Multi-tenant businesses with roles and permissions, invitations, team management, plan-based team limits;
  cross-tenant isolation test that covers every business route.
- Platform staff roles (verifier, finance, support, admin) with MFA-verified sessions and separation of duties.
- Audit log, uniform errors with request ids, secret redaction, security headers on API and web.

**Supply side (businesses)**
- Business profile, documents (type checked from the bytes), submit for review, staff approve/request changes/reject.
- Listings (category-specific rules, EN/AR text, photos, prices, dates, cancellation policy, publish/pause/edit).
- Subscriptions: plans, free trial, add-ons, grace period, invoices, plan limits enforced on publishing, team size and
  new bookings; analytics with plan-based depth; promo codes (marketing).

**Booking and money (real money stays OFF by design)**
- Availability, server-side pricing, holds, strict capacity (race-tested), idempotent bookings, waitlist (strict
  first-come-first-served), request-to-book (behind a flag), cancellation with policy snapshot, check-in codes,
  calendar files, CSV export, completion and verified reviews.
- Manual payment proofs (unverified evidence), finance verification, balanced append-only ledger, commission snapshots,
  refunds (policy-driven, partial), payouts (three-person rule, hold period), subscription payments (manual).

**Customer and staff experience (web, English and Arabic with right-to-left)**
- Immersive home, explore with real filters (region, date + guests against real seats, price, type), cinematic
  experience page with lightbox, nearby experiences and sticky booking card, fresh colour system, dark mode.
- Account pages, My bookings (payment proof form, ticket, calendar, review), waitlist, notifications, security page.
- Business workspace (profile, documents, team, listings, bookings, check-in, plan) and staff console (company review,
  payment proofs, refunds, payouts, subscription requests, review moderation).

**Quality and operations**
- Concurrency stress test, backup/restore drill (passed), runbook, demo seed data, local dev mailbox.

## Left to do

**Needs something from you**
1. Real photography and an optional hero video (drop into `apps/web/public/brand/` and `public/regions/`).
2. A map tile provider and key (interactive map on explore and experience pages).
3. Email provider and keys (verification, reminders, receipts), Google sign-in credentials, SMS/WhatsApp if wanted.
4. An AI provider key (AI gateway, drafting tools, credits). None is faked.
5. Legal sign-off and a provider decision before any real money moves (card/wallet collection, custody of funds).
6. Production storage (S3-compatible), antivirus scanner, hosting target, backups policy, domain and TLS.
7. Confirm my assumed numbers: cancellation tiers, 60-minute waitlist offers, 48-hour request answer window,
   48-hour payout hold, 15% annual discount, 10% trial commission.
8. Review my Arabic copy and the region names/blurbs.

**I can build without you (next, in this order)**
1. Mobile page speed: under real DevTools throttling LCP is about 2.2 s (target 2.5 s met on localhost); Lighthouse's simulated mode still shows about 3.5 s. Not yet measured on a real phone or network.
2. Map: component is BUILT; production needs a licensed tile provider (set the two map env vars).
3. Business UI for promo codes, refund requests, payout view and analytics charts; staff UI for invoices.
4. (Done: content pages, staff-featured list, indicative LBP estimate, map component, CI job definitions.) Still to do: prove the CI workflow on GitHub, real load tests, remaining hardening.
7. Referral programme and campaigns once an email provider exists.
