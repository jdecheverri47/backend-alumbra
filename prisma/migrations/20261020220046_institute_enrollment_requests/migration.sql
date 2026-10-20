-- CreateEnum
CREATE TYPE "InstituteRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "InstituteEnrollmentRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "note" TEXT,
    "status" "InstituteRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstituteEnrollmentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InstituteEnrollmentRequest_status_idx" ON "InstituteEnrollmentRequest"("status");

-- CreateIndex
CREATE INDEX "InstituteEnrollmentRequest_userId_createdAt_idx" ON "InstituteEnrollmentRequest"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "InstituteEnrollmentRequest" ADD CONSTRAINT "InstituteEnrollmentRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstituteEnrollmentRequest" ADD CONSTRAINT "InstituteEnrollmentRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Una sola solicitud pendiente por persona (Prisma no expresa índices parciales).
CREATE UNIQUE INDEX "InstituteEnrollmentRequest_one_pending_per_user"
  ON "InstituteEnrollmentRequest"("userId") WHERE status = 'PENDING';
