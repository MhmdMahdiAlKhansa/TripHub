-- Property hosts and nightly stays.
ALTER TYPE "RateKind" ADD VALUE IF NOT EXISTS 'NIGHT';
ALTER TYPE "RateKind" ADD VALUE IF NOT EXISTS 'WEEKEND_NIGHT';
ALTER TYPE "RateKind" ADD VALUE IF NOT EXISTS 'CLEANING';

CREATE TYPE "SlotKind" AS ENUM ('TRIP', 'STAY', 'BLOCK');
CREATE TYPE "CompanyKind" AS ENUM ('OPERATOR', 'HOST');

ALTER TABLE "company" ADD COLUMN "kind" "CompanyKind" NOT NULL DEFAULT 'OPERATOR';
ALTER TABLE "slot" ADD COLUMN "kind" "SlotKind" NOT NULL DEFAULT 'TRIP', ADD COLUMN "note" TEXT;

-- A stay or a block always has an end.
ALTER TABLE "slot" ADD CONSTRAINT slot_range_has_end CHECK ("kind" = 'TRIP' OR "endsAt" IS NOT NULL);

-- Never double-book a property: while a stay holds its night (reserved > 0) or a host block exists, no other
-- stay or block on the same listing may overlap it. Back-to-back stays (check-out 11:00, check-in 14:00) are fine.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "slot" ADD CONSTRAINT slot_no_overlapping_stays EXCLUDE USING gist (
  "listingId" WITH =,
  tstzrange("startsAt", "endsAt", '[)') WITH &&
) WHERE ("kind" = 'BLOCK' OR ("kind" = 'STAY' AND "reserved" > 0));
