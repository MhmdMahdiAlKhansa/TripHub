# Acceptance Checklist (all unchecked – nothing implemented yet)

## Launch gates
- [ ] All features in MASTER_SPEC implemented and traced in requirements-traceability.md
- [ ] 0 overbooking in race simulations; DB CHECK verified
- [ ] Ledger invariants (zero-sum, immutability, idempotency) pass
- [ ] Tenant-isolation suite covers every tenant route
- [ ] Payment/refund/payout statuses truthful (no completion without verification)
- [ ] Trial / grace / expiry / downgrade lifecycle tests pass
- [ ] AI: grounded, credit-race-safe, privacy-redacted, human-approved publishing, fallback works
- [ ] EN/AR parity (translation check) and RTL E2E pass; WCAG 2.2 AA axe pass
- [ ] Security scans: no high/critical; MFA enforced for sensitive roles
- [ ] Backup restore drill performed and documented
- [ ] Load tests meet targets (p95 search < 500 ms, hold < 300 ms at target load)
- [ ] Runbooks, incident response, admin manual, README, `.env.example`, seeds (demo-labeled)
- [ ] Legal/provider dependencies reviewed and flags set correctly for production
- [ ] Feature-by-feature acceptance report produced
