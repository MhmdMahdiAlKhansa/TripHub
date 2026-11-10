-- CreateTable
CREATE TABLE "login_code" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "consumedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_code_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "login_code_userId_createdAt_idx" ON "login_code"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "login_code" ADD CONSTRAINT "login_code_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
