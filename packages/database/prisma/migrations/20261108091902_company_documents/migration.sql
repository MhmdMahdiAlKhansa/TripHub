-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('BUSINESS_LICENSE', 'OWNER_ID', 'OTHER');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('PENDING', 'CLEAN', 'INFECTED');

-- CreateTable
CREATE TABLE "company_document" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "companyId" UUID NOT NULL,
    "kind" "DocumentKind" NOT NULL,
    "originalName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "scanStatus" "ScanStatus" NOT NULL DEFAULT 'PENDING',
    "uploadedBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "company_document_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_document_storageKey_key" ON "company_document"("storageKey");

-- CreateIndex
CREATE INDEX "company_document_companyId_deletedAt_idx" ON "company_document"("companyId", "deletedAt");

-- AddForeignKey
ALTER TABLE "company_document" ADD CONSTRAINT "company_document_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "company_document" ADD CONSTRAINT company_document_size CHECK ("sizeBytes" BETWEEN 1 AND 5242880);
ALTER TABLE "company_document" ADD CONSTRAINT company_document_type CHECK ("contentType" IN ('application/pdf', 'image/png', 'image/jpeg', 'image/webp'));
-- Documents are evidence: never edited; only soft-deleted (deletedAt) so review history stays intact.
CREATE FUNCTION company_document_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'documents cannot be hard-deleted'; END IF;
  IF NEW."sha256" IS DISTINCT FROM OLD."sha256" OR NEW."storageKey" IS DISTINCT FROM OLD."storageKey"
     OR NEW."companyId" IS DISTINCT FROM OLD."companyId" OR NEW."contentType" IS DISTINCT FROM OLD."contentType" THEN
    RAISE EXCEPTION 'document content is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER company_document_guard BEFORE UPDATE OR DELETE ON "company_document" FOR EACH ROW EXECUTE FUNCTION company_document_guard();
