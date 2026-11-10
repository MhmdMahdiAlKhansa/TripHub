# Load tests

Run: start the API with `RATE_LIMIT_DISABLED=1` (honoured only outside production) and `DEV_MAILBOX=1`, start the web app,
then `corepack pnpm --filter @triphub/loadtest load`. The script is `apps/loadtest/run.mjs`.

**How to read these numbers.** They come from ONE Windows developer machine running the API, web server, Postgres and
Redis together, against a development database that already holds thousands of rows from test runs. They are a
regression baseline, not a capacity promise. There has been no test against a deployed environment, a separate database
host, or realistic network latency.

## Read paths (12 s each, 20-40 connections, no errors in any run)

| Endpoint | req/s | p50 | p99 |
|---|---:|---:|---:|
| API GET /public/listings | 108 | 367 ms | 492 ms |
| API GET /public/listings?q=DEMO (Arabic-aware search) | 114 | 337 ms | 560 ms |
| API GET /public/listings (region + guests + type filters) | 79 | 478 ms | 842 ms |
| API GET /public/listings/:id | 336 | 111 ms | 256 ms |
| API GET /public/listings/:id/availability | 274 | 121 ms | 1824 ms |
| Web GET /en (server-rendered home) | 39 | 485 ms | 1311 ms |
| Web GET /en/explore (server-rendered) | 37 | 544 ms | 812 ms |

The list endpoints are the slowest API paths (joins for text, prices, images, company). The web pages are slower than
the API because each render calls several API endpoints. Neither is cached yet.

## Booking contention (the important one)

150 verified customers fire a booking for 1 seat each, simultaneously, at one date with 100 seats:

| | Before tuning | After tuning |
|---|---:|---:|
| Confirmed | 100 | 100 |
| Refused as full | 50 | 50 |
| Other errors | 0 | 0 |
| Seats reserved at the end | 100 / 100 | 100 / 100 |
| Wall time for all 150 | 5.8 s | 3.2 s |
| Latency p50 / p99 | 5.6 s / 5.8 s | 3.1 s / 3.2 s |

The invariant held in every run: exactly the available seats were sold, never more. The tuning removed a slot-row lock
and a global scan from the hot booking path (the waitlist is only touched when someone is actually waiting) and made
the database pool size configurable (`DATABASE_POOL_MAX`, default 20). One hot date still serialises on that slot's
row (about 47 bookings per second here); that is the price of never overbooking, and different dates do not block
each other.

## Check-in under load
60 customers book a date that starts in 1 hour; all 60 tickets are scanned at the same moment, then all 60 again:
first scan 60 accepted in 239 ms, second scan 60 refused (already checked in) in 227 ms. Each ticket is accepted
exactly once. (Runs through the same script, `pnpm --filter @triphub/loadtest load`, which exits non-zero if either
invariant fails.)

## Not measured yet
- Payment proof submission (payments are switched off by default), analytics and admin queues under load.
- Sustained (soak) runs, memory growth, and recovery after database restarts.
- Any run against a deployed environment.
