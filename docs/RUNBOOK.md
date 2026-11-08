# TripHub runbook (local and pre-production)

Status: describes what exists today. There is no production environment yet; nothing here has been run
against one.

## Processes
| Process | Command | Notes |
|---|---|---|
| API | `corepack pnpm --filter @triphub/api start` (after `build`) | `GET /api/v1/health/live`, `/health/ready`; docs at `/api/docs` (non-production) |
| Worker | `corepack pnpm --filter @triphub/worker start` | holds expiry + waitlist promotion every minute, subscription settling every 10 min |
| Web | `corepack pnpm --filter @triphub/web start` | proxies `/api/*` to `API_INTERNAL_URL` |

## Configuration that matters
- `WEB_ORIGIN` must list the exact web origin(s); the API rejects state-changing browser requests from any other origin.
- `MFA_ENCRYPTION_KEY` (>= 32 chars) is required in production. It also derives the ticket-signing key. Rotating it
  invalidates stored MFA secrets and issued ticket codes; plan a migration before rotating.
- `TRUST_PROXY` must be set behind a proxy so rate limits see the client address.
- Object storage: only local disk exists (`STORAGE_DIR`). The API refuses to start in production without a real adapter.
- Feature flags (`payments`, `requestToBook`) are in code (`apps/api/src/config/features.ts`), default OFF, and are not
  changed by environment variables on purpose. Turning real money on needs legal sign-off first (see DECISIONS D-12).

## Backups and restore
- `bash infrastructure/scripts/backup-restore-drill.sh` dumps the local database, restores it into a scratch database,
  compares every table's row count, re-checks that the ledger balances, that all triggers survived and that the
  ledger is still append-only, then drops the scratch database. It passed on 2026-11-08 against a 11.5 MB database
  (32 tables, 19 triggers). It does NOT cover: point-in-time recovery, off-site copies, encryption at rest, retention,
  or restore of uploaded files (stored separately).
- A production backup policy (frequency, retention, PITR, tested RTO/RPO) is NOT defined.

## Staff accounts
There is no screen or API to grant platform roles on purpose. A person registers and verifies like anyone else, enables
two-step verification on /security, and a database administrator then sets the role, for example:
`UPDATE "user" SET "platformRole" = 'FINANCE' WHERE email = '...';`
(roles: SUPPORT, VERIFIER, FINANCE, ADMIN). Staff actions require an MFA-verified session; money and review decisions
also require a recent password step-up. Record every grant in your own change log.

## Money operations (manual, by design)
- Payment proofs are unverified claims. Finance verifies actual receipt, then verifies the payment in the admin API.
- Refunds and payouts need three different finance people (request, approve, attest the transfer) and a unique
  transfer reference; the ledger moves only on the attested transfer.
- The ledger is append-only (database triggers). Corrections are new reversing entries, never edits.

## Known gaps before any launch
See `docs/PROGRESS.md` ("NOT DONE" in each row) and `docs/ACCEPTANCE_CHECKLIST.md` (all gates still open).
