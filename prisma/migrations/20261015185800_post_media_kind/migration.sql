-- CreateEnum
CREATE TYPE "PostMediaKind" AS ENUM ('IMAGE', 'VIDEO');

-- AlterTable
ALTER TABLE "PostImage" ADD COLUMN     "kind" "PostMediaKind" NOT NULL DEFAULT 'IMAGE';
