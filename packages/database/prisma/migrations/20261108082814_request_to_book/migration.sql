-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BookingStatus" ADD VALUE 'REQUESTED';
ALTER TYPE "BookingStatus" ADD VALUE 'DECLINED';

-- AlterTable
ALTER TABLE "booking" ADD COLUMN     "decidedAt" TIMESTAMPTZ(6),
ADD COLUMN     "declineReason" TEXT,
ADD COLUMN     "requestExpiresAt" TIMESTAMPTZ(6);
