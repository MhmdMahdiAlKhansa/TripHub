-- AlterTable
ALTER TABLE "listing" ADD COLUMN     "featuredAt" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "exchange_rate" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "lbpPerUsd" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID NOT NULL,

    CONSTRAINT "exchange_rate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "exchange_rate_effectiveFrom_idx" ON "exchange_rate"("effectiveFrom");

ALTER TABLE "exchange_rate" ADD CONSTRAINT exchange_rate_range CHECK ("lbpPerUsd" BETWEEN 1000 AND 10000000);
CREATE TRIGGER exchange_rate_append_only BEFORE UPDATE OR DELETE ON "exchange_rate" FOR EACH ROW EXECUTE FUNCTION append_only_guard();
