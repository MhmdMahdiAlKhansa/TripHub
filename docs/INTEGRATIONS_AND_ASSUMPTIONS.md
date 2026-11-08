# Integrations & Assumptions

| Integration | v1 mode | Needed to go live | Blocker owner |
|---|---|---|---|
| Whish / OMT payments | Manual instructions + proof upload + manual verification | Provider API/contract, webhook secrets | Business/legal |
| Platform fund custody & payouts | Flag `custody_payments` OFF in prod | Legal review of local licensing, tax, merchant rules | Legal |
| Tax/invoicing | Configurable tax rates, non-fiscal invoices labeled as such | Lebanese tax advice | Finance/legal |
| Google OAuth | Real adapter; dev uses test creds | OAuth client ID/secret, consent screen | User |
| Email | SMTP (Mailpit local); prod adapter | Provider account, domain SPF/DKIM | User |
| SMS / WhatsApp / push | Adapter interfaces only, disabled | Provider contract + consent framework | User |
| AI (Gemini, OpenAI) | Adapters + Mock; real calls only with keys | API keys, data-processing terms check (retention/training) | User |
| Maps / geocoding | MapLibre+OSM tiles; geocoding flagged | Tile/geocode provider choice + budget | User |
| Object storage / CDN | MinIO local; S3/R2 prod | Cloud account | User |
| Malware scanning | ClamAV container | none | — |
| Hosting | Docker-based | Cloud account, domain | User |
| Imagery & editorial | Placeholder labeled demo; licensed assets required before launch | Photography licenses | User |

## Assumptions (flag if wrong)
- Launch region Lebanon; timezone Asia/Beirut; currencies USD + LBP with admin-set rate.
- Annual discount 15% and trial commission 10% are initial config, not commitments.
- Purchased AI credits do not expire pending legal review.
- No real money moves in the system before legal sign-off; staging uses mock/labeled flows.
- Single region, single database; scale-up path = read replica, then extract worker.
