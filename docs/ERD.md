# Entity relationship diagram (core)

The full schema is `packages/database/prisma/schema.prisma` (about 45 models). This diagram shows the tables the core
flow touches: publish a trip, take bookings up to capacity, track deposits, waitlist, check-in. Billing, ledger,
promos, reviews and platform admin tables are omitted for readability.

```mermaid
erDiagram
  USER ||--o{ MEMBERSHIP : "belongs to businesses"
  COMPANY ||--o{ MEMBERSHIP : "has team"
  COMPANY ||--o{ LISTING : "publishes"
  LISTING ||--o{ LISTING_TRANSLATION : "en / ar"
  LISTING ||--o{ LISTING_RATE : "ADULT / CHILD / GROUP"
  LISTING ||--o{ LISTING_IMAGE : "photos"
  LISTING ||--o{ SLOT : "dates"
  SLOT ||--o{ BOOKING : "seats"
  SLOT ||--o{ HOLD : "temporary seats"
  SLOT ||--o{ WAITLIST_ENTRY : "FIFO queue"
  COMPANY ||--o{ LISTING : "HOST kind: stays only"
  USER ||--o{ BOOKING : "customer"
  BOOKING ||--o| HOLD : "while awaiting deposit"
  BOOKING ||--o{ DEPOSIT : "Whish / OMT / cash"
  BOOKING ||--o{ PAYMENT : "platform custody (flag off)"
  USER ||--o{ NOTIFICATION : "in-app + emailed"
  USER ||--o{ SESSION : "server-side sessions"

  USER {
    uuid id PK
    text email UK
    text passwordHash "nullable (Google-only accounts)"
    text googleSub UK
    enum status "ACTIVE SUSPENDED DELETED"
    enum platformRole "NONE SUPPORT VERIFIER FINANCE ADMIN"
    timestamptz mfaEnabledAt
  }
  COMPANY {
    uuid id PK
    text slug UK
    enum status "DRAFT PENDING_REVIEW CHANGES_REQUESTED APPROVED REJECTED SUSPENDED"
    enum kind "OPERATOR HOST"
    text city
    int commissionBps
  }
  MEMBERSHIP {
    uuid companyId FK
    uuid userId FK
    enum role "OWNER MANAGER BOOKING_STAFF FINANCE"
    enum status "ACTIVE REMOVED"
  }
  LISTING {
    uuid id PK
    uuid companyId FK
    enum category
    enum bookingMode "DISCOVERY_ONLY FIXED_DATE TIME_SLOT REQUEST_TO_BOOK NIGHTLY"
    enum status "DRAFT PUBLISHED PAUSED ARCHIVED"
    text meetingPoint
    text[] pickupPoints
    int depositPercent "1..100"
    int holdMinutes
    enum cancellationPolicy
    timestamptz featuredAt
  }
  SLOT {
    uuid id PK
    uuid listingId FK
    timestamptz startsAt
    int capacity
    int reserved "never above capacity (CHECK + row lock)"
    enum kind "TRIP STAY BLOCK"
    timestamptz endsAt "STAY/BLOCK: check-out; ranges never overlap (EXCLUDE gist)"
    enum status "OPEN CLOSED"
  }
  BOOKING {
    uuid id PK
    text reference UK
    uuid slotId FK
    uuid customerId FK
    enum status "REQUESTED HELD CONFIRMED CANCELLED EXPIRED COMPLETED DECLINED"
    int quantity
    bigint totalMinor
    text currency
    json snapshot "immutable terms (trigger)"
    text contactPhone
    text pickupPoint
    text emergencyContactName
    text emergencyContactPhone
    timestamptz checkedInAt
    timestamptz reminderSentAt
    text idempotencyKey
  }
  HOLD {
    uuid bookingId FK
    enum status "ACTIVE CONSUMED RELEASED EXPIRED"
    timestamptz expiresAt
  }
  DEPOSIT {
    uuid id PK
    uuid bookingId FK
    uuid companyId FK
    enum method "WHISH OMT CASH"
    bigint amountMinor "> 0, append-only (trigger)"
    text currency
    uuid recordedBy
  }
  WAITLIST_ENTRY {
    int seq "strict FIFO"
    uuid slotId FK
    uuid customerId FK
    int seats
    enum status "WAITING OFFERED CONVERTED CANCELLED EXPIRED"
    timestamptz offerExpiresAt
  }
  NOTIFICATION {
    uuid userId FK
    text kind "waitlist.offer booking.reminder deposit.received ..."
    timestamptz emailedAt
  }
```

Integrity rules enforced in the database, not only in code: `slot.reserved <= capacity`; no two live stays or blocks overlap on a property (exclusion constraint); append-only `audit_event`,
`deposit`, `ledger_*`, `plan_price`, `invoice`; immutable `booking.snapshot`; at least one active OWNER per company;
unique `(method, reference)` on platform payments; single-use tokens.
