# Security & Privacy

## Threat model
| Threat | Controls |
|---|---|
| Cross-tenant access | Tenant guard from membership; repositories require `companyId`; UUIDv7 IDs; 404 not 403 on foreign resources; automated isolation suite hitting every route |
| Double-booking | Row lock + CHECK constraint + idempotency + race tests |
| Double-charge / duplicate ledger | Idempotency keys, unique `(source, source_id)` on journal, zero-sum trigger |
| Payment-proof fraud | Proof = unverified evidence; verifier ≠ uploader; reference uniqueness; audit |
| Payout manipulation | Two-person approval, step-up, edit lockout after approval, audit, bank-detail change cooldown |
| Privilege escalation | Deny-by-default permission strings, last-owner guard, no self-approval, session invalidation on role change |
| Invitation abuse | Single-use hashed tokens, expiry, email binding, rate limits |
| AI prompt injection / leakage | Tool-less grounding via retrieval of tenant-scoped data only; output validation; PII redaction; no secrets/docs/payment evidence to models; human approval before publish |
| Upload malware | Type/size allowlist, magic-byte check, ClamAV, private bucket, signed short-lived URLs |
| Credential attacks | argon2id, rate limits, lockout/backoff, MFA, breached-password check (k-anon), device list |
| Web attacks | CSP, HSTS, SameSite cookies, CSRF token on cookie-auth mutations, output encoding, parameterized queries |

## Data classification
Public · Internal · Personal (PII) · Sensitive (verification docs, payment evidence, bank details, IDs). Sensitive data: private bucket, encrypted at rest, access audited, never logged, never sent to AI.

## Privacy
Consent records with history (marketing, AI personalization, geolocation). Export & deletion workflows (financial records retained/anonymized per legal need). Retention: AI raw prompts ≤7d; verification evidence per policy after resolution; operational logs configurable. Provider data-handling terms must be verified before enabling each provider (see INTEGRATIONS_AND_ASSUMPTIONS).

## Secrets & ops
Env-based secrets (no commit), secret scanning in CI, least-privilege DB roles (app vs migrator), dependency/container scanning, backups with PITR and restore drills, incident-response runbook, audit log immutability (no UPDATE/DELETE grant).

## Launch gate
No open high/critical findings; MFA enforced for admin and finance roles; restore drill passed.
