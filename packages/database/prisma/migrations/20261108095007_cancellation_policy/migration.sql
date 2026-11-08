-- CreateEnum
CREATE TYPE "CancellationPolicy" AS ENUM ('FLEXIBLE', 'MODERATE', 'STRICT', 'NON_REFUNDABLE');

-- AlterTable
ALTER TABLE "booking" ADD COLUMN     "cancelledBy" TEXT;

-- AlterTable
ALTER TABLE "listing" ADD COLUMN     "cancellationPolicy" "CancellationPolicy" NOT NULL DEFAULT 'MODERATE';
ALTER TABLE "booking" ADD CONSTRAINT booking_cancelled_by CHECK ("cancelledBy" IS NULL OR "cancelledBy" IN ('CUSTOMER', 'BUSINESS'));
