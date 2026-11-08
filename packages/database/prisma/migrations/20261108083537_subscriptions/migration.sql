-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "SubscriptionRequestStatus" AS ENUM ('OPEN', 'FULFILLED', 'CANCELLED');

-- CreateTable
CREATE TABLE "plan_price" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "planCode" TEXT NOT NULL,
    "monthlyMinor" BIGINT NOT NULL,
    "commissionBps" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "effectiveFrom" TIMESTAMPTZ(6) NOT NULL,
    "createdBy" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_price_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "planCode" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "cycle" "BillingCycle",
    "trialStartedAt" TIMESTAMPTZ(6),
    "trialEndsAt" TIMESTAMPTZ(6),
    "trialConsentBy" UUID,
    "currentPeriodStart" TIMESTAMPTZ(6),
    "currentPeriodEnd" TIMESTAMPTZ(6),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "addOns" JSONB NOT NULL DEFAULT '{}',
    "monthlyMinor" BIGINT NOT NULL DEFAULT 0,
    "commissionBps" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_request" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "planCode" TEXT NOT NULL,
    "cycle" "BillingCycle" NOT NULL,
    "addOns" JSONB NOT NULL DEFAULT '{}',
    "status" "SubscriptionRequestStatus" NOT NULL DEFAULT 'OPEN',
    "requestedBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMPTZ(6),

    CONSTRAINT "subscription_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "number" TEXT NOT NULL,
    "companyId" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "requestId" UUID,
    "planCode" TEXT NOT NULL,
    "cycle" "BillingCycle" NOT NULL,
    "periodStart" TIMESTAMPTZ(6) NOT NULL,
    "periodEnd" TIMESTAMPTZ(6) NOT NULL,
    "lines" JSONB NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "paymentMethod" TEXT NOT NULL,
    "paymentReference" TEXT NOT NULL,
    "recordedBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plan_price_planCode_effectiveFrom_key" ON "plan_price"("planCode", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_companyId_key" ON "subscription"("companyId");

-- CreateIndex
CREATE INDEX "subscription_request_companyId_status_idx" ON "subscription_request"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_number_key" ON "invoice"("number");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_requestId_key" ON "invoice"("requestId");

-- CreateIndex
CREATE INDEX "invoice_companyId_idx" ON "invoice"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_paymentMethod_paymentReference_key" ON "invoice"("paymentMethod", "paymentReference");

-- AddForeignKey
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_request" ADD CONSTRAINT "subscription_request_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Reference data: initial effective-dated plan prices (USD cents). Not demo data.
INSERT INTO "plan_price" ("planCode", "monthlyMinor", "commissionBps", "effectiveFrom") VALUES
  ('TRIAL',   0,    1000, '2020-01-01T00:00:00Z'),
  ('STARTER', 1900, 1000, '2020-01-01T00:00:00Z'),
  ('GROWTH',  4900, 700,  '2020-01-01T00:00:00Z'),
  ('PRO',     9900, 400,  '2020-01-01T00:00:00Z');

ALTER TABLE "plan_price" ADD CONSTRAINT plan_price_range CHECK ("monthlyMinor" >= 0 AND "commissionBps" BETWEEN 0 AND 10000);
ALTER TABLE "plan_price" ADD CONSTRAINT plan_price_plan CHECK ("planCode" IN ('TRIAL', 'STARTER', 'GROWTH', 'PRO'));
ALTER TABLE "subscription" ADD CONSTRAINT subscription_plan CHECK ("planCode" IN ('TRIAL', 'STARTER', 'GROWTH', 'PRO', 'ENTERPRISE'));
ALTER TABLE "subscription" ADD CONSTRAINT subscription_commission CHECK ("commissionBps" BETWEEN 0 AND 10000);
ALTER TABLE "subscription_request" ADD CONSTRAINT subscription_request_plan CHECK ("planCode" IN ('STARTER', 'GROWTH', 'PRO'));
ALTER TABLE "invoice" ADD CONSTRAINT invoice_amount CHECK ("amountMinor" > 0);

-- One open request per business at a time.
CREATE UNIQUE INDEX subscription_request_one_open ON "subscription_request" ("companyId") WHERE "status" = 'OPEN';

-- Price history and invoices are append-only: contracts keep their terms and records stay auditable.
CREATE FUNCTION append_only_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER plan_price_append_only BEFORE UPDATE OR DELETE ON "plan_price" FOR EACH ROW EXECUTE FUNCTION append_only_guard();
CREATE TRIGGER invoice_append_only BEFORE UPDATE OR DELETE ON "invoice" FOR EACH ROW EXECUTE FUNCTION append_only_guard();

-- A subscription is never deleted (downgrades and cancellations keep the history).
CREATE TRIGGER subscription_no_delete BEFORE DELETE ON "subscription" FOR EACH ROW EXECUTE FUNCTION append_only_guard();
