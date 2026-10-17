-- CreateTable
CREATE TABLE "InstituteClass" (
    "id" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "location" TEXT,
    "meetingUrl" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "InstituteClass_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InstituteClass_startsAt_idx" ON "InstituteClass"("startsAt");

-- AddForeignKey
ALTER TABLE "InstituteClass" ADD CONSTRAINT "InstituteClass_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "InstituteModule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstituteClass" ADD CONSTRAINT "InstituteClass_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
