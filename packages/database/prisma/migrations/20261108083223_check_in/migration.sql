-- AlterTable
ALTER TABLE "booking" ADD COLUMN     "checkedInAt" TIMESTAMPTZ(6),
ADD COLUMN     "checkedInBy" UUID;
