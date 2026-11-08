# Test Strategy

| Layer | Tooling | Scope |
|---|---|---|
| Unit | Vitest | State-transition tables (exhaustive allowed/denied), pricing/quote, FX rounding, commission, cancellation policy, entitlement checks, credit lot ordering |
| Property | fast-check | Ledger zero-sum, quote determinism, capacity never negative |
| Integration | Vitest + real Postgres/Redis (Testcontainers/Compose) | Repositories, transactions, constraints, idempotency, outbox, webhooks signature |
| Concurrency | custom harness | N parallel holds on last seat → exactly capacity succeed; parallel credit reservations; double refund; double payout; waitlist promotion run twice |
| Isolation | generated per-route suite | Every tenant route tested with another tenant's token and IDs |
| Contract | OpenAPI schema diff + generated client | Breaking-change detection |
| E2E | Playwright (EN + AR/RTL, mobile + desktop) | Journeys J1–J8 |
| A11y | axe + keyboard flows | WCAG 2.2 AA on key pages, both locales and themes |
| Security | Semgrep, npm audit, Trivy, ZAP baseline | CI gates |
| Load | k6 | Search, listing pages, booking hold spike |
| Truthfulness | targeted | Proof upload never yields "paid"; refund/payout completed only after verification; mock providers labeled |
| Lifecycle | time-travel (injectable clock) | Trial activation window, expiry, grace, renewals, credit expiry, hold expiry |
| AI | eval datasets + provider-failure sims | Grounding, no fabricated listings, fallback, privacy redaction, injection set |
| Ops | scripted | Backup/restore drill |

CI gate: typecheck, lint, unit, integration, isolation, contract, i18n completeness, build, security scans; E2E on staging/PR label.
