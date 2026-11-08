-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "BookingMode" AS ENUM ('DISCOVERY_ONLY', 'FIXED_DATE', 'TIME_SLOT', 'REQUEST_TO_BOOK');

-- CreateTable
CREATE TABLE "listing" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "bookingMode" "BookingMode" NOT NULL DEFAULT 'DISCOVERY_ONLY',
    "status" "ListingStatus" NOT NULL DEFAULT 'DRAFT',
    "city" TEXT,
    "address" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "meetingPoint" TEXT,
    "meetingLatitude" DECIMAL(9,6),
    "meetingLongitude" DECIMAL(9,6),
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "publishedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "listing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_translation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "listingId" UUID NOT NULL,
    "locale" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "description" TEXT,

    CONSTRAINT "listing_translation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "listing_companyId_status_idx" ON "listing"("companyId", "status");

-- CreateIndex
CREATE INDEX "listing_status_category_idx" ON "listing"("status", "category");

-- CreateIndex
CREATE UNIQUE INDEX "listing_translation_listingId_locale_key" ON "listing_translation"("listingId", "locale");

-- AddForeignKey
ALTER TABLE "listing" ADD CONSTRAINT "listing_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_translation" ADD CONSTRAINT "listing_translation_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
