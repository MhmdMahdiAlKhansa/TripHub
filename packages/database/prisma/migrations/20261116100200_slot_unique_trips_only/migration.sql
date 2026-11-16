-- "One departure per start time" applies to trips only. Stays and blocks are governed by the no-overlap
-- exclusion constraint instead, and a cancelled stay's old slot must not stop the same dates being booked again.
DROP INDEX IF EXISTS "slot_listingId_startsAt_key";
ALTER TABLE "slot" DROP CONSTRAINT IF EXISTS "slot_listingId_startsAt_key";
CREATE UNIQUE INDEX "slot_listingId_startsAt_trip_key" ON "slot"("listingId", "startsAt") WHERE "kind" = 'TRIP';
CREATE INDEX "slot_listingId_startsAt_idx" ON "slot"("listingId", "startsAt");
