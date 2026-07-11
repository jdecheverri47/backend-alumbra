-- AlterEnum
ALTER TYPE "JourneyStage" ADD VALUE 'APLAZADO';

-- AlterTable
ALTER TABLE "MembershipJourney" ADD COLUMN     "assignedLeaderId" TEXT;

-- AddForeignKey
ALTER TABLE "MembershipJourney" ADD CONSTRAINT "MembershipJourney_assignedLeaderId_fkey" FOREIGN KEY ("assignedLeaderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
