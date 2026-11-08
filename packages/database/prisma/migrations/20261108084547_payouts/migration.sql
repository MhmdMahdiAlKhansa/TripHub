-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('REQUESTED', 'APPROVED', 'PAID', 'REJECTED');

-- CreateTable
CREATE TABLE "payout" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'REQUESTED',
    "note" TEXT,
    "requestedBy" UUID NOT NULL,
    "requestedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedBy" UUID,
    "decidedAt" TIMESTAMPTZ(6),
    "decisionReason" TEXT,
    "paidBy" UUID,
    "paidAt" TIMESTAMPTZ(6),
    "payoutReference" TEXT,

    CONSTRAINT "payout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payout_companyId_status_idx" ON "payout"("companyId", "status");

-- CreateIndex
CREATE INDEX "payout_status_requestedAt_idx" ON "payout"("status", "requestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "payout_payoutReference_key" ON "payout"("payoutReference");

-- AddForeignKey
ALTER TABLE "payout" ADD CONSTRAINT "payout_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
ALTER TABLE "payout" ADD CONSTRAINT payout_amount_positive CHECK ("amountMinor" > 0);
ALTER TABLE "payout" ADD CONSTRAINT payout_currency CHECK ("currency" IN ('USD', 'LBP'));
ALTER TABLE "payout" ADD CONSTRAINT payout_decider_differs CHECK ("decidedBy" IS NULL OR "decidedBy" <> "requestedBy");
ALTER TABLE "payout" ADD CONSTRAINT payout_payer_differs CHECK ("paidBy" IS NULL OR ("paidBy" <> "requestedBy" AND "paidBy" IS DISTINCT FROM "decidedBy"));
ALTER TABLE "payout" ADD CONSTRAINT payout_paid_has_proof CHECK ("status" <> 'PAID' OR ("paidBy" IS NOT NULL AND "paidAt" IS NOT NULL AND "payoutReference" IS NOT NULL));

CREATE FUNCTION payout_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'payouts cannot be deleted'; END IF;
  IF NEW."amountMinor" IS DISTINCT FROM OLD."amountMinor" OR NEW."currency" IS DISTINCT FROM OLD."currency"
     OR NEW."companyId" IS DISTINCT FROM OLD."companyId" OR NEW."requestedBy" IS DISTINCT FROM OLD."requestedBy" THEN
    RAISE EXCEPTION 'payout terms are immutable';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
       (OLD."status" = 'REQUESTED' AND NEW."status" IN ('APPROVED', 'REJECTED'))
    OR (OLD."status" = 'APPROVED' AND NEW."status" = 'PAID')) THEN
    RAISE EXCEPTION 'invalid payout transition % -> %', OLD."status", NEW."status";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER payout_guard BEFORE UPDATE OR DELETE ON "payout" FOR EACH ROW EXECUTE FUNCTION payout_guard();
