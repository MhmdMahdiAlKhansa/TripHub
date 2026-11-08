-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('WHISH', 'OMT');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PROOF_SUBMITTED', 'VERIFIED', 'VERIFIED_UNALLOCATED', 'REJECTED');

-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('PLATFORM_CASH', 'COMPANY_PAYABLE', 'PLATFORM_COMMISSION', 'REFUND_PAYABLE');

-- AlterTable
ALTER TABLE "company" ADD COLUMN     "commissionBps" INTEGER NOT NULL DEFAULT 1000;

-- CreateTable
CREATE TABLE "payment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bookingId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PROOF_SUBMITTED',
    "reference" TEXT,
    "note" TEXT,
    "decidedBy" UUID,
    "decidedAt" TIMESTAMPTZ(6),
    "decisionReason" TEXT,
    "submittedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_account" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" "LedgerAccountType" NOT NULL,
    "companyId" UUID,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entry" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "bookingId" UUID,
    "paymentId" UUID,
    "reversesId" UUID,
    "description" TEXT NOT NULL,
    "postedBy" UUID,
    "postedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_line" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entryId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,

    CONSTRAINT "ledger_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_bookingId_idx" ON "payment"("bookingId");

-- CreateIndex
CREATE INDEX "payment_status_submittedAt_idx" ON "payment"("status", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "payment_method_reference_key" ON "payment"("method", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entry_idempotencyKey_key" ON "journal_entry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "journal_entry_bookingId_idx" ON "journal_entry"("bookingId");

-- CreateIndex
CREATE INDEX "journal_entry_paymentId_idx" ON "journal_entry"("paymentId");

-- CreateIndex
CREATE INDEX "ledger_line_entryId_idx" ON "ledger_line"("entryId");

-- CreateIndex
CREATE INDEX "ledger_line_accountId_idx" ON "ledger_line"("accountId");

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_account" ADD CONSTRAINT "ledger_account_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_line" ADD CONSTRAINT "ledger_line_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "journal_entry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_line" ADD CONSTRAINT "ledger_line_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ledger_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Payments: sanity and one-open-proof / one-verified-payment per booking.
ALTER TABLE "payment" ADD CONSTRAINT payment_amount_positive CHECK ("amountMinor" > 0);
ALTER TABLE "payment" ADD CONSTRAINT payment_currency CHECK ("currency" IN ('USD', 'LBP'));
ALTER TABLE "company" ADD CONSTRAINT company_commission_range CHECK ("commissionBps" BETWEEN 0 AND 10000);

CREATE UNIQUE INDEX payment_one_open_per_booking ON "payment" ("bookingId") WHERE "status" = 'PROOF_SUBMITTED';
CREATE UNIQUE INDEX payment_one_verified_per_booking ON "payment" ("bookingId") WHERE "status" IN ('VERIFIED', 'VERIFIED_UNALLOCATED');

-- A decided payment keeps its decision: only the deciding fields may be written, once.
CREATE FUNCTION payment_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'payments cannot be deleted'; END IF;
  IF NEW."amountMinor" IS DISTINCT FROM OLD."amountMinor"
     OR NEW."currency" IS DISTINCT FROM OLD."currency"
     OR NEW."bookingId" IS DISTINCT FROM OLD."bookingId"
     OR NEW."customerId" IS DISTINCT FROM OLD."customerId"
     OR NEW."method" IS DISTINCT FROM OLD."method"
     OR NEW."reference" IS DISTINCT FROM OLD."reference" THEN
    RAISE EXCEPTION 'payment terms are immutable';
  END IF;
  IF OLD."status" <> 'PROOF_SUBMITTED' AND NEW."status" IS DISTINCT FROM OLD."status" THEN
    RAISE EXCEPTION 'a decided payment cannot change status';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER payment_guard BEFORE UPDATE OR DELETE ON "payment" FOR EACH ROW EXECUTE FUNCTION payment_guard();

-- ---------------------------------------------------------------------------
-- Ledger accounts: one per (type, currency) for platform accounts, one per (type, company, currency) otherwise.
CREATE UNIQUE INDEX ledger_account_platform_unique ON "ledger_account" ("type", "currency") WHERE "companyId" IS NULL;
CREATE UNIQUE INDEX ledger_account_company_unique ON "ledger_account" ("type", "companyId", "currency") WHERE "companyId" IS NOT NULL;
ALTER TABLE "ledger_account" ADD CONSTRAINT ledger_account_currency CHECK ("currency" IN ('USD', 'LBP'));
ALTER TABLE "ledger_account" ADD CONSTRAINT ledger_account_company_rule
  CHECK (("type" = 'COMPANY_PAYABLE') = ("companyId" IS NOT NULL));

INSERT INTO "ledger_account" ("type", "currency") VALUES
  ('PLATFORM_CASH', 'USD'), ('PLATFORM_CASH', 'LBP'),
  ('PLATFORM_COMMISSION', 'USD'), ('PLATFORM_COMMISSION', 'LBP'),
  ('REFUND_PAYABLE', 'USD'), ('REFUND_PAYABLE', 'LBP');

-- ---------------------------------------------------------------------------
-- The journal is append-only.
CREATE FUNCTION ledger_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'the ledger is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER journal_entry_immutable BEFORE UPDATE OR DELETE ON "journal_entry" FOR EACH ROW EXECUTE FUNCTION ledger_immutable();
CREATE TRIGGER ledger_line_immutable BEFORE UPDATE OR DELETE ON "ledger_line" FOR EACH ROW EXECUTE FUNCTION ledger_immutable();
CREATE TRIGGER journal_entry_no_truncate BEFORE TRUNCATE ON "journal_entry" FOR EACH STATEMENT EXECUTE FUNCTION ledger_immutable();
CREATE TRIGGER ledger_line_no_truncate BEFORE TRUNCATE ON "ledger_line" FOR EACH STATEMENT EXECUTE FUNCTION ledger_immutable();

ALTER TABLE "ledger_line" ADD CONSTRAINT ledger_line_nonzero CHECK ("amountMinor" <> 0);

-- A line's currency must equal its account's currency.
CREATE FUNCTION ledger_line_currency_check() RETURNS trigger AS $$
DECLARE acct_currency text;
BEGIN
  SELECT "currency" INTO acct_currency FROM "ledger_account" WHERE "id" = NEW."accountId";
  IF acct_currency IS DISTINCT FROM NEW."currency" THEN
    RAISE EXCEPTION 'ledger line currency % does not match account currency %', NEW."currency", acct_currency;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER ledger_line_currency BEFORE INSERT ON "ledger_line" FOR EACH ROW EXECUTE FUNCTION ledger_line_currency_check();

-- Every journal entry must balance to zero in each currency, checked at COMMIT.
CREATE FUNCTION ledger_entry_balanced() RETURNS trigger AS $$
DECLARE bad integer;
BEGIN
  SELECT count(*) INTO bad FROM (
    SELECT "currency" FROM "ledger_line" WHERE "entryId" = NEW."entryId"
    GROUP BY "currency" HAVING sum("amountMinor") <> 0
  ) s;
  IF bad > 0 THEN RAISE EXCEPTION 'journal entry % does not balance', NEW."entryId"; END IF;
  IF (SELECT count(*) FROM "ledger_line" WHERE "entryId" = NEW."entryId") < 2 THEN
    RAISE EXCEPTION 'journal entry % needs at least two lines', NEW."entryId";
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER ledger_entry_balanced
  AFTER INSERT ON "ledger_line" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_entry_balanced();
