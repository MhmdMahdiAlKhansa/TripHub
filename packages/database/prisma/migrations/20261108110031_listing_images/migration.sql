-- CreateTable
CREATE TABLE "listing_image" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "listingId" UUID NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "alt" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "uploadedBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "listing_image_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "listing_image_storageKey_key" ON "listing_image"("storageKey");

-- CreateIndex
CREATE INDEX "listing_image_listingId_deletedAt_position_idx" ON "listing_image"("listingId", "deletedAt", "position");

-- AddForeignKey
ALTER TABLE "listing_image" ADD CONSTRAINT "listing_image_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "listing_image" ADD CONSTRAINT listing_image_size CHECK ("sizeBytes" BETWEEN 1 AND 5242880);
ALTER TABLE "listing_image" ADD CONSTRAINT listing_image_type CHECK ("contentType" IN ('image/png', 'image/jpeg', 'image/webp'));
CREATE FUNCTION listing_image_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'images cannot be hard-deleted'; END IF;
  IF NEW."sha256" IS DISTINCT FROM OLD."sha256" OR NEW."storageKey" IS DISTINCT FROM OLD."storageKey"
     OR NEW."listingId" IS DISTINCT FROM OLD."listingId" OR NEW."contentType" IS DISTINCT FROM OLD."contentType" THEN
    RAISE EXCEPTION 'image content is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER listing_image_guard BEFORE UPDATE OR DELETE ON "listing_image" FOR EACH ROW EXECUTE FUNCTION listing_image_guard();
