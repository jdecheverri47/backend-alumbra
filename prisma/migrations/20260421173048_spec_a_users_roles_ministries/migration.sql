/*
  Warnings:

  - You are about to drop the `Health` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "BaseRole" AS ENUM ('ASISTENTE', 'MIEMBRO');

-- CreateEnum
CREATE TYPE "MinistryRole" AS ENUM ('LEADER', 'MEMBER');

-- DropTable
DROP TABLE "Health";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "baseRole" "BaseRole" NOT NULL DEFAULT 'ASISTENTE',
    "isPastor" BOOLEAN NOT NULL DEFAULT false,
    "phone" TEXT,
    "photoUrl" TEXT,
    "googleId" TEXT,
    "birthDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ministry" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Ministry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MinistryMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ministryId" TEXT NOT NULL,
    "role" "MinistryRole" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "MinistryMembership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");

-- CreateIndex
CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Ministry_slug_key" ON "Ministry"("slug");

-- CreateIndex
CREATE INDEX "MinistryMembership_ministryId_idx" ON "MinistryMembership"("ministryId");

-- CreateIndex
CREATE INDEX "MinistryMembership_userId_idx" ON "MinistryMembership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MinistryMembership_userId_ministryId_joinedAt_key" ON "MinistryMembership"("userId", "ministryId", "joinedAt");

-- AddForeignKey
ALTER TABLE "MinistryMembership" ADD CONSTRAINT "MinistryMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MinistryMembership" ADD CONSTRAINT "MinistryMembership_ministryId_fkey" FOREIGN KEY ("ministryId") REFERENCES "Ministry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
