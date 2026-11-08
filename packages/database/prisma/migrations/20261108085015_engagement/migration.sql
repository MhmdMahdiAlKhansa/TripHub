-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('VISIBLE', 'HIDDEN');

-- CreateTable
CREATE TABLE "favorite" (
    "userId" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorite_pkey" PRIMARY KEY ("userId","listingId")
);

-- CreateTable
CREATE TABLE "review" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bookingId" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "status" "ReviewStatus" NOT NULL DEFAULT 'VISIBLE',
    "moderationReason" TEXT,
    "moderatedBy" UUID,
    "moderatedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "favorite_listingId_idx" ON "favorite"("listingId");

-- CreateIndex
CREATE UNIQUE INDEX "review_bookingId_key" ON "review"("bookingId");

-- CreateIndex
CREATE INDEX "review_listingId_status_createdAt_idx" ON "review"("listingId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "review_companyId_idx" ON "review"("companyId");

-- AddForeignKey
ALTER TABLE "favorite" ADD CONSTRAINT "favorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorite" ADD CONSTRAINT "favorite_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review" ADD CONSTRAINT "review_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review" ADD CONSTRAINT "review_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
ALTER TABLE "review" ADD CONSTRAINT review_rating_range CHECK ("rating" BETWEEN 1 AND 5);
ALTER TABLE "review" ADD CONSTRAINT review_comment_len CHECK ("comment" IS NULL OR char_length("comment") <= 2000);
ALTER TABLE "review" ADD CONSTRAINT review_moderation_has_reason CHECK ("status" = 'VISIBLE' OR ("moderationReason" IS NOT NULL AND "moderatedBy" IS NOT NULL));

-- A review can only exist for the reviewer's own COMPLETED booking, and its content can never be edited.
CREATE FUNCTION review_guard() RETURNS trigger AS $$
DECLARE b RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'reviews cannot be deleted'; END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT "status", "customerId", "listingId", "companyId" INTO b FROM "booking" WHERE "id" = NEW."bookingId";
    IF NOT FOUND OR b."status" <> 'COMPLETED' OR b."customerId" <> NEW."customerId"
       OR b."listingId" <> NEW."listingId" OR b."companyId" <> NEW."companyId" THEN
      RAISE EXCEPTION 'a review requires the reviewer''s own completed booking';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."rating" IS DISTINCT FROM OLD."rating" OR NEW."comment" IS DISTINCT FROM OLD."comment"
     OR NEW."bookingId" IS DISTINCT FROM OLD."bookingId" OR NEW."customerId" IS DISTINCT FROM OLD."customerId" THEN
    RAISE EXCEPTION 'review content is immutable (moderation may only change visibility)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER review_guard BEFORE INSERT OR UPDATE OR DELETE ON "review" FOR EACH ROW EXECUTE FUNCTION review_guard();
