# TripHub Master Spec (condensed; the Codex Master Prompt remains the source text)

## 1. Actors
Guest · Customer · Business roles (Owner, Manager, Booking staff, Finance, custom) · Platform roles (Super admin, Verifier, Finance admin, Support, Content editor, Moderator). Users may belong to many companies.

## 2. Permission matrix (excerpt; full matrix generated from `packages/shared/permissions.ts` and tested)
| Permission | Owner | Manager | Booking | Finance | Platform Finance | Platform Verifier |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| company.profile.edit | ✔ | ✔ | | | | |
| team.manage | ✔ | | | | | |
| listing.write / publish | ✔ | ✔ | | | | |
| booking.view / manage | ✔ | ✔ | ✔ | view | | |
| booking.checkin | ✔ | ✔ | ✔ | | | |
| payment.verify | ✔* | | | ✔ | ✔ | |
| refund.request | ✔ | ✔ | ✔ | ✔ | | |
| refund.approve (≠ requester) | ✔ | | | ✔ | ✔ | |
| payout.edit / approve | | | | | ✔ (two-person) | |
| company.verify | | | | | | ✔ |
| billing.manage | ✔ | | | ✔ | | |
| ai.use | ✔ | ✔ | | | | |
*Business-verified payments only for payments the business receives directly; platform-collected funds are verified by platform finance.

Rules: deny by default; no self-approval; final owner cannot be removed/demoted; sensitive actions require MFA step-up (<10 min).

## 3. Core user journeys
J1 Business: register → verify email → onboarding (saveable) → submit docs → admin approve → publish listing → (activate trial) → receive bookings.
J2 Customer: discover/search (EN/AR) → listing → quote → 3-step booking (details, review/policies, pay/confirm) → hold → pay/proof or instant → QR ticket → review.
J3 Waitlist: join → offer (expiring) → accept → hold → confirm.
J4 Cancellation/refund: request → policy snapshot calc → approve (separate actor) → record transfer → verified → ledger.
J5 Payout: eligible earnings → payout batch → two-person approval → transfer evidence → verified completion.
J6 Subscription: trial eligible → activate (consent) → reminders → convert only on affirmative consent → renew/upgrade/downgrade/grace.
J7 AI: customer NL search grounded in indexed listings with deterministic fallback; business copy/translation drafts need human approval to publish; credits preflight → reserve → settle.
J8 Admin: verification queue, featured companies ordering (4–8), moderation, FX rates, provider config, disputes.

## 4. Business rules (selected, normative)
- Totals/quotes always server-calculated; booking stores immutable `snapshot` (price lines, taxes, currency, FX rate, commission rate, cancellation policy version, plan).
- Discovery-only listings expose no booking, availability, or verified reviews.
- Pending/unverified companies can draft; cannot publish or accept bookings.
- A HELD seat is never displayed as confirmed.
- Proof screenshot ⇒ status `PROOF_SUBMITTED` (“awaiting verification”) only.
- Refund/payout “completed” only after verified transfer evidence by authorized actor.
- Downgrade never deletes data; blocks new over-limit activity.
- Trials never auto-convert; no card required.
- Trial campaign = one configured campaign launched to opt-in audience; max 3; no free SMS/WhatsApp.
- Reviews: one per eligible completed booking, 1–5, optional comment; admin moderation requires reason + audit.
- Plans/add-ons per the spec table, stored as effective-dated price rows; existing contracts keep old terms.
- Marketing add-on ($12/mo) entitlement: unlimited campaigns to opt-in audiences (email + in-app), promo codes, referral program, campaign analytics; SMS/WhatsApp sends excluded (provider cost passed through when enabled).
- AI daily/rate caps and monthly budget cap block (not auto-increase); 80% warning.

## 5. Out of v1 (adapter-ready, flagged off)
Live Whish/OMT API, SMS/WhatsApp/push, live card payments, direct merchant settlement, native mobile apps.

## 6. Cost assumptions (monthly, staging+prod, rough)
Postgres $25–60, containers $30–80, Redis $0–15, object storage/CDN $5–20, email $0–20, maps $0 (OSM) ± geocoding, AI budget cap admin-set (default $10 until raised), monitoring $0–30. Estimates only; not quotes.
