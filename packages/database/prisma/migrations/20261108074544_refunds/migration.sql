-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'APPROVED', 'PAID', 'REJECTED');

-- CreateTable
CREATE TABLE "refund" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "paymentId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" TEXT NOT NULL,
    "requestedBy" UUID NOT NULL,
    "requestedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedBy" UUID,
    "decidedAt" TIMESTAMPTZ(6),
    "decisionReason" TEXT,
    "paidBy" UUID,
    "paidAt" TIMESTAMPTZ(6),
    "payoutReference" TEXT,

    CONSTRAINT "refund_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "refund_paymentId_key" ON "refund"("paymentId");

-- CreateIndex
CREATE INDEX "refund_status_requestedAt_idx" ON "refund"("status", "requestedAt");

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
ALTER TABLE "refund" ADD CONSTRAINT refund_amount_positive CHECK ("amountMinor" > 0);
ALTER TABLE "refund" ADD CONSTRAINT refund_currency CHECK ("currency" IN ('USD', 'LBP'));
-- Separation of duties, enforced by the database as well as the API.
ALTER TABLE "refund" ADD CONSTRAINT refund_decider_differs CHECK ("decidedBy" IS NULL OR "decidedBy" <> "requestedBy");
ALTER TABLE "refund" ADD CONSTRAINT refund_payer_differs CHECK ("paidBy" IS NULL OR ("paidBy" <> "requestedBy" AND "paidBy" IS DISTINCT FROM "decidedBy"));
ALTER TABLE "refund" ADD CONSTRAINT refund_paid_has_proof CHECK ("status" <> 'PAID' OR ("paidBy" IS NOT NULL AND "paidAt" IS NOT NULL AND "payoutReference" IS NOT NULL));

CREATE FUNCTION refund_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'refunds cannot be deleted'; END IF;
  IF NEW."amountMinor" IS DISTINCT FROM OLD."amountMinor" OR NEW."currency" IS DISTINCT FROM OLD."currency"
     OR NEW."paymentId" IS DISTINCT FROM OLD."paymentId" OR NEW."requestedBy" IS DISTINCT FROM OLD."requestedBy" THEN
    RAISE EXCEPTION 'refund terms are immutable';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
       (OLD."status" = 'REQUESTED' AND NEW."status" IN ('APPROVED', 'REJECTED'))
    OR (OLD."status" = 'APPROVED' AND NEW."status" = 'PAID')) THEN
    RAISE EXCEPTION 'invalid refund transition % -> %', OLD."status", NEW."status";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER refund_guard BEFORE UPDATE OR DELETE ON "refund" FOR EACH ROW EXECUTE FUNCTION refund_guard();
