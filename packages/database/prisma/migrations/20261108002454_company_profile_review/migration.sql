-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('NONE', 'SUPPORT', 'VERIFIER', 'FINANCE', 'ADMIN');

-- CreateEnum
CREATE TYPE "ReviewDecision" AS ENUM ('APPROVED', 'CHANGES_REQUESTED', 'REJECTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CompanyStatus" ADD VALUE 'CHANGES_REQUESTED';
ALTER TYPE "CompanyStatus" ADD VALUE 'REJECTED';

-- AlterTable
ALTER TABLE "company" ADD COLUMN     "address" TEXT,
ADD COLUMN     "approvedAt" TIMESTAMPTZ(6),
ADD COLUMN     "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "city" TEXT,
ADD COLUMN     "contactEmail" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "latitude" DECIMAL(9,6),
ADD COLUMN     "longitude" DECIMAL(9,6),
ADD COLUMN     "onboardingStep" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "socials" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "submittedAt" TIMESTAMPTZ(6),
ADD COLUMN     "website" TEXT;

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "platformRole" "PlatformRole" NOT NULL DEFAULT 'NONE';

-- CreateTable
CREATE TABLE "company_review" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "reviewerId" UUID NOT NULL,
    "decision" "ReviewDecision" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_review_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "company_review_companyId_createdAt_idx" ON "company_review"("companyId", "createdAt");

-- AddForeignKey
ALTER TABLE "company_review" ADD CONSTRAINT "company_review_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
