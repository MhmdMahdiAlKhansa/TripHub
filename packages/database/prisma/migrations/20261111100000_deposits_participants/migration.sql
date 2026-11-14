-- Operator-collected deposits, participant details and the day-before reminder flag.
CREATE TYPE "DepositMethod" AS ENUM ('WHISH', 'OMT', 'CASH');

ALTER TABLE "listing"
  ADD COLUMN "pickupPoints" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "depositPercent" INTEGER NOT NULL DEFAULT 100;
ALTER TABLE "listing" ADD CONSTRAINT listing_deposit_percent CHECK ("depositPercent" BETWEEN 1 AND 100);

ALTER TABLE "booking"
  ADD COLUMN "pickupPoint" TEXT,
  ADD COLUMN "emergencyContactName" TEXT,
  ADD COLUMN "emergencyContactPhone" TEXT,
  ADD COLUMN "reminderSentAt" TIMESTAMPTZ(6);

CREATE TABLE "deposit" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "bookingId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "method" "DepositMethod" NOT NULL,
  "amountMinor" BIGINT NOT NULL,
  "currency" TEXT NOT NULL,
  "reference" TEXT,
  "note" TEXT,
  "recordedBy" UUID NOT NULL,
  "recordedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "deposit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT deposit_amount_positive CHECK ("amountMinor" > 0)
);
CREATE INDEX "deposit_bookingId_idx" ON "deposit"("bookingId");
CREATE INDEX "deposit_companyId_recordedAt_idx" ON "deposit"("companyId", "recordedAt");
ALTER TABLE "deposit" ADD CONSTRAINT "deposit_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Deposits are records of money received: they can be added, never edited or deleted.
CREATE OR REPLACE FUNCTION th_deposit_append_only() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'deposit rows are append-only'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER deposit_append_only BEFORE UPDATE OR DELETE ON "deposit" FOR EACH ROW EXECUTE FUNCTION th_deposit_append_only();
