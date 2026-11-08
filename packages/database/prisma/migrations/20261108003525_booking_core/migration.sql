-- CreateEnum
CREATE TYPE "RateKind" AS ENUM ('ADULT', 'CHILD', 'GROUP');

-- CreateEnum
CREATE TYPE "SlotStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('HELD', 'CONFIRMED', 'CANCELLED', 'EXPIRED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "HoldStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'EXPIRED', 'RELEASED');

-- AlterTable
ALTER TABLE "listing" ADD COLUMN     "holdMinutes" INTEGER NOT NULL DEFAULT 15;

-- CreateTable
CREATE TABLE "listing_rate" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "listingId" UUID NOT NULL,
    "kind" "RateKind" NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "groupSize" INTEGER,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_rate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slot" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "listingId" UUID NOT NULL,
    "startsAt" TIMESTAMPTZ(6) NOT NULL,
    "endsAt" TIMESTAMPTZ(6),
    "capacity" INTEGER NOT NULL,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "status" "SlotStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "slot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reference" TEXT NOT NULL,
    "companyId" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "slotId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "status" "BookingStatus" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "totalMinor" BIGINT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "cancelledAt" TIMESTAMPTZ(6),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hold" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bookingId" UUID NOT NULL,
    "slotId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "HoldStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "resolvedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "listing_rate_listingId_kind_key" ON "listing_rate"("listingId", "kind");

-- CreateIndex
CREATE INDEX "slot_startsAt_idx" ON "slot"("startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "slot_listingId_startsAt_key" ON "slot"("listingId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "booking_reference_key" ON "booking"("reference");

-- CreateIndex
CREATE INDEX "booking_companyId_status_idx" ON "booking"("companyId", "status");

-- CreateIndex
CREATE INDEX "booking_slotId_idx" ON "booking"("slotId");

-- CreateIndex
CREATE INDEX "booking_customerId_idx" ON "booking"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "booking_customerId_idempotencyKey_key" ON "booking"("customerId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "hold_bookingId_key" ON "hold"("bookingId");

-- CreateIndex
CREATE INDEX "hold_status_expiresAt_idx" ON "hold"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "hold_slotId_status_idx" ON "hold"("slotId", "status");

-- AddForeignKey
ALTER TABLE "listing_rate" ADD CONSTRAINT "listing_rate_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slot" ADD CONSTRAINT "slot_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "slot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hold" ADD CONSTRAINT "hold_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hold" ADD CONSTRAINT "hold_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "slot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Capacity can never be exceeded or go negative, whatever the application does.
ALTER TABLE "slot" ADD CONSTRAINT slot_capacity_nonneg CHECK ("capacity" >= 0);
ALTER TABLE "slot" ADD CONSTRAINT slot_reserved_within_capacity CHECK ("reserved" >= 0 AND "reserved" <= "capacity");
ALTER TABLE "slot" ADD CONSTRAINT slot_ends_after_start CHECK ("endsAt" IS NULL OR "endsAt" > "startsAt");

-- Platform-enforced hold window (minutes): 5..30.
ALTER TABLE "listing" ADD CONSTRAINT listing_hold_minutes_range CHECK ("holdMinutes" BETWEEN 5 AND 30);

-- Money sanity.
ALTER TABLE "listing_rate" ADD CONSTRAINT rate_amount_nonneg CHECK ("amountMinor" >= 0);
ALTER TABLE "listing_rate" ADD CONSTRAINT rate_currency CHECK ("currency" IN ('USD', 'LBP'));
ALTER TABLE "listing_rate" ADD CONSTRAINT rate_group_size CHECK (("kind" = 'GROUP') = ("groupSize" IS NOT NULL) AND ("groupSize" IS NULL OR "groupSize" >= 1));
ALTER TABLE "booking" ADD CONSTRAINT booking_total_nonneg CHECK ("totalMinor" >= 0);
ALTER TABLE "booking" ADD CONSTRAINT booking_quantity_positive CHECK ("quantity" >= 1);
ALTER TABLE "booking" ADD CONSTRAINT booking_currency CHECK ("currency" IN ('USD', 'LBP'));
ALTER TABLE "hold" ADD CONSTRAINT hold_quantity_positive CHECK ("quantity" >= 1);

-- A booking's priced terms are immutable once created. Changes need a new booking/amendment record.
CREATE FUNCTION booking_terms_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW."totalMinor" IS DISTINCT FROM OLD."totalMinor"
     OR NEW."currency" IS DISTINCT FROM OLD."currency"
     OR NEW."quantity" IS DISTINCT FROM OLD."quantity"
     OR NEW."snapshot" IS DISTINCT FROM OLD."snapshot"
     OR NEW."slotId" IS DISTINCT FROM OLD."slotId"
     OR NEW."customerId" IS DISTINCT FROM OLD."customerId"
     OR NEW."listingId" IS DISTINCT FROM OLD."listingId"
     OR NEW."companyId" IS DISTINCT FROM OLD."companyId"
     OR NEW."reference" IS DISTINCT FROM OLD."reference" THEN
    RAISE EXCEPTION 'booking terms are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER booking_terms_immutable
  BEFORE UPDATE ON "booking"
  FOR EACH ROW EXECUTE FUNCTION booking_terms_immutable();

-- Bookings are financial/legal records: they can never be deleted.
CREATE FUNCTION booking_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'bookings cannot be deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER booking_no_delete
  BEFORE DELETE ON "booking"
  FOR EACH ROW EXECUTE FUNCTION booking_no_delete();
