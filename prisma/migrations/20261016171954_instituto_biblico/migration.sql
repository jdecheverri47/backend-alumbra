-- CreateEnum
CREATE TYPE "InstituteRole" AS ENUM ('STUDENT', 'TEACHER');

-- CreateEnum
CREATE TYPE "InstituteItemKind" AS ENUM ('MATERIAL', 'ASSIGNMENT', 'EXAM');

-- CreateEnum
CREATE TYPE "InstituteAttachmentKind" AS ENUM ('FILE', 'LINK', 'YOUTUBE', 'FORM');

-- CreateEnum
CREATE TYPE "InstituteSubmissionState" AS ENUM ('TURNED_IN', 'RETURNED');

-- CreateTable
CREATE TABLE "InstituteModule" (
    "id" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "classroomId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "InstituteModule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstituteItem" (
    "id" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "kind" "InstituteItemKind" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "maxPoints" INTEGER,
    "dueAt" TIMESTAMP(3),
    "publishAt" TIMESTAMP(3),
    "authorId" TEXT NOT NULL,
    "classroomId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "InstituteItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstituteAttachment" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "kind" "InstituteAttachmentKind" NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mimeType" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InstituteAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstituteEnrollment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "InstituteRole" NOT NULL DEFAULT 'STUDENT',
    "classroomId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "InstituteEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstituteSubmission" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "state" "InstituteSubmissionState",
    "turnedInAt" TIMESTAMP(3),
    "late" BOOLEAN NOT NULL DEFAULT false,
    "grade" DOUBLE PRECISION,
    "draftGrade" DOUBLE PRECISION,
    "gradedById" TEXT,
    "gradedAt" TIMESTAMP(3),
    "classroomId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstituteSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InstituteModule_classroomId_key" ON "InstituteModule"("classroomId");

-- CreateIndex
CREATE INDEX "InstituteModule_order_idx" ON "InstituteModule"("order");

-- CreateIndex
CREATE UNIQUE INDEX "InstituteItem_classroomId_key" ON "InstituteItem"("classroomId");

-- CreateIndex
CREATE INDEX "InstituteItem_moduleId_idx" ON "InstituteItem"("moduleId");

-- CreateIndex
CREATE INDEX "InstituteItem_publishAt_idx" ON "InstituteItem"("publishAt");

-- CreateIndex
CREATE INDEX "InstituteAttachment_itemId_idx" ON "InstituteAttachment"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "InstituteEnrollment_userId_key" ON "InstituteEnrollment"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "InstituteSubmission_classroomId_key" ON "InstituteSubmission"("classroomId");

-- CreateIndex
CREATE INDEX "InstituteSubmission_studentId_idx" ON "InstituteSubmission"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "InstituteSubmission_itemId_studentId_key" ON "InstituteSubmission"("itemId", "studentId");

-- AddForeignKey
ALTER TABLE "InstituteItem" ADD CONSTRAINT "InstituteItem_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "InstituteModule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstituteItem" ADD CONSTRAINT "InstituteItem_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstituteAttachment" ADD CONSTRAINT "InstituteAttachment_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InstituteItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstituteEnrollment" ADD CONSTRAINT "InstituteEnrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstituteSubmission" ADD CONSTRAINT "InstituteSubmission_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InstituteItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstituteSubmission" ADD CONSTRAINT "InstituteSubmission_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstituteSubmission" ADD CONSTRAINT "InstituteSubmission_gradedById_fkey" FOREIGN KEY ("gradedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
