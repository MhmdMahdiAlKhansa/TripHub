-- CreateEnum
CREATE TYPE "WaitlistStatus" AS ENUM ('WAITING', 'OFFERED', 'CONVERTED', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "waitlist_entry" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "seq" SERIAL NOT NULL,
    "slotId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "seats" INTEGER NOT NULL,
    "status" "WaitlistStatus" NOT NULL DEFAULT 'WAITING',
    "offeredAt" TIMESTAMPTZ(6),
    "offerExpiresAt" TIMESTAMPTZ(6),
    "resolvedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waitlist_entry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "waitlist_entry_slotId_status_seq_idx" ON "waitlist_entry"("slotId", "status", "seq");

-- CreateIndex
CREATE INDEX "waitlist_entry_customerId_idx" ON "waitlist_entry"("customerId");

-- AddForeignKey
ALTER TABLE "waitlist_entry" ADD CONSTRAINT "waitlist_entry_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "slot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entry" ADD CONSTRAINT "waitlist_entry_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
ALTER TABLE "waitlist_entry" ADD CONSTRAINT waitlist_seats_range CHECK ("seats" BETWEEN 1 AND 20);
ALTER TABLE "waitlist_entry" ADD CONSTRAINT waitlist_offer_has_expiry CHECK ("status" <> 'OFFERED' OR "offerExpiresAt" IS NOT NULL);
-- A customer is in the queue for a slot at most once at a time.
CREATE UNIQUE INDEX waitlist_one_active_per_customer ON "waitlist_entry" ("slotId", "customerId") WHERE "status" IN ('WAITING', 'OFFERED');
