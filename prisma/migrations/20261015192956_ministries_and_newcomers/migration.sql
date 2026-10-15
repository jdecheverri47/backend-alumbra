-- CreateEnum
CREATE TYPE "NewcomerStatus" AS ENUM ('NUEVO', 'CONTACTADO', 'EN_SEGUIMIENTO', 'INTEGRADO', 'NO_CONTINUA');

-- CreateEnum
CREATE TYPE "NewcomerInterest" AS ENUM ('CONOCER_MAS', 'GRUPO_CONEXION', 'BAUTISMO', 'SERVIR', 'ORACION', 'CONSEJERIA');

-- CreateEnum
CREATE TYPE "FollowUpKind" AS ENUM ('LLAMADA', 'MENSAJE', 'VISITA', 'ENCUENTRO', 'OTRO');

-- CreateTable
CREATE TABLE "Newcomer" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "birthDate" TIMESTAMP(3),
    "neighborhood" TEXT,
    "firstVisitAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "howHeard" TEXT,
    "invitedBy" TEXT,
    "interests" "NewcomerInterest"[],
    "prayerRequest" TEXT,
    "notes" TEXT,
    "consent" BOOLEAN NOT NULL DEFAULT false,
    "status" "NewcomerStatus" NOT NULL DEFAULT 'NUEVO',
    "registeredById" TEXT NOT NULL,
    "assignedToId" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Newcomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewcomerFollowUp" (
    "id" TEXT NOT NULL,
    "newcomerId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "kind" "FollowUpKind" NOT NULL DEFAULT 'LLAMADA',
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NewcomerFollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Newcomer_userId_key" ON "Newcomer"("userId");

-- CreateIndex
CREATE INDEX "Newcomer_status_idx" ON "Newcomer"("status");

-- CreateIndex
CREATE INDEX "Newcomer_firstVisitAt_idx" ON "Newcomer"("firstVisitAt");

-- CreateIndex
CREATE INDEX "Newcomer_assignedToId_idx" ON "Newcomer"("assignedToId");

-- CreateIndex
CREATE INDEX "NewcomerFollowUp_newcomerId_idx" ON "NewcomerFollowUp"("newcomerId");

-- AddForeignKey
ALTER TABLE "Newcomer" ADD CONSTRAINT "Newcomer_registeredById_fkey" FOREIGN KEY ("registeredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Newcomer" ADD CONSTRAINT "Newcomer_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Newcomer" ADD CONSTRAINT "Newcomer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewcomerFollowUp" ADD CONSTRAINT "NewcomerFollowUp_newcomerId_fkey" FOREIGN KEY ("newcomerId") REFERENCES "Newcomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewcomerFollowUp" ADD CONSTRAINT "NewcomerFollowUp_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Los seis ministerios de la iglesia. Si alguno ya existe (Acogida venía del
-- seed) se deja como está.
INSERT INTO "Ministry" ("id", "slug", "name", "description", "updatedAt") VALUES
  (gen_random_uuid()::text, 'acogida', 'Acogida', 'Recibe a las personas nuevas y les hace seguimiento.', NOW()),
  (gen_random_uuid()::text, 'servidores', 'Servidores', 'Sirve en la logística y el cuidado de cada reunión.', NOW()),
  (gen_random_uuid()::text, 'alabanza', 'Alabanza', 'Guía a la iglesia en la adoración con música.', NOW()),
  (gen_random_uuid()::text, 'palabra', 'Palabra', 'Enseña y predica la Palabra.', NOW()),
  (gen_random_uuid()::text, 'multimedia', 'Multimedia', 'Sonido, transmisión, diseño y redes.', NOW()),
  (gen_random_uuid()::text, 'alcance-mision', 'Alcance y Misión', 'Lleva el evangelio a la ciudad y acompaña la obra misionera.', NOW())
ON CONFLICT ("slug") DO NOTHING;

-- Acogida venía del seed con una descripción de antes del módulo.
UPDATE "Ministry"
SET "description" = 'Recibe a las personas nuevas y les hace seguimiento.', "updatedAt" = NOW()
WHERE "slug" = 'acogida'
  AND "description" = 'Ministerio encargado de recibir y registrar nuevos asistentes como prospectos.';
