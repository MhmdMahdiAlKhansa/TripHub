-- CreateEnum
CREATE TYPE "PromoKind" AS ENUM ('PERCENT', 'FIXED');

-- CreateTable
CREATE TABLE "promo_code" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "PromoKind" NOT NULL,
    "percentBps" INTEGER,
    "amountMinor" BIGINT,
    "currency" TEXT,
    "listingId" UUID,
    "validFrom" TIMESTAMPTZ(6),
    "validTo" TIMESTAMPTZ(6),
    "maxRedemptions" INTEGER,
    "redeemed" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_code_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_redemption" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "promoId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "discountMinor" BIGINT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_redemption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "promo_code_companyId_code_key" ON "promo_code"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "promo_redemption_bookingId_key" ON "promo_redemption"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "promo_redemption_promoId_customerId_key" ON "promo_redemption"("promoId", "customerId");

-- AddForeignKey
ALTER TABLE "promo_code" ADD CONSTRAINT "promo_code_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promo_redemption" ADD CONSTRAINT "promo_redemption_promoId_fkey" FOREIGN KEY ("promoId") REFERENCES "promo_code"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "promo_code" ADD CONSTRAINT promo_code_shape CHECK (
  ("kind" = 'PERCENT' AND "percentBps" BETWEEN 1 AND 10000 AND "amountMinor" IS NULL AND "currency" IS NULL)
  OR ("kind" = 'FIXED' AND "amountMinor" > 0 AND "currency" IN ('USD', 'LBP') AND "percentBps" IS NULL));
ALTER TABLE "promo_code" ADD CONSTRAINT promo_code_counts CHECK ("redeemed" >= 0 AND ("maxRedemptions" IS NULL OR ("maxRedemptions" >= 1 AND "redeemed" <= "maxRedemptions")));
ALTER TABLE "promo_code" ADD CONSTRAINT promo_code_dates CHECK ("validFrom" IS NULL OR "validTo" IS NULL OR "validFrom" < "validTo");
ALTER TABLE "promo_code" ADD CONSTRAINT promo_code_format CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{2,23}$');
