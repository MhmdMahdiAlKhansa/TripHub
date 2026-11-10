-- AlterTable
ALTER TABLE "user" ADD COLUMN "googleSub" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "user_googleSub_key" ON "user"("googleSub");
