-- CreateEnum
CREATE TYPE "JourneyStage" AS ENUM ('PRE_ENTREVISTA', 'VALIDADO', 'EN_RUTA', 'ENTREGA_FINAL', 'FILTRO_IGLESIA', 'ENTREVISTA_PASTORAL', 'MIEMBRO', 'NO_CONTINUA');

-- AlterEnum
ALTER TYPE "GroupType" ADD VALUE 'CURSO';

-- AlterTable
ALTER TABLE "Group" ADD COLUMN     "courseId" TEXT;

-- AlterTable
ALTER TABLE "GroupSession" ADD COLUMN     "lessonId" TEXT;

-- CreateTable
CREATE TABLE "Course" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "prerequisiteId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseTopic" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "CourseTopic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseLesson" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "CourseLesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseLessonTask" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "CourseLessonTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseCompletion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "certifiedById" TEXT NOT NULL,

    CONSTRAINT "CourseCompletion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembershipJourney" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stage" "JourneyStage" NOT NULL DEFAULT 'PRE_ENTREVISTA',
    "interviewerId" TEXT,
    "preInterviewAt" TIMESTAMP(3),
    "preInterviewNotes" TEXT,
    "validatedAt" TIMESTAMP(3),
    "rutaGroupId" TEXT,
    "rutaCompletedAt" TIMESTAMP(3),
    "essayUrl" TEXT,
    "testimony" TEXT,
    "imageUrl" TEXT,
    "finalSubmittedAt" TIMESTAMP(3),
    "churchFilterOpenedAt" TIMESTAMP(3),
    "churchFilterClosedAt" TIMESTAMP(3),
    "churchFilterPassed" BOOLEAN,
    "pastoralInterviewAt" TIMESTAMP(3),
    "covenantSignedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MembershipJourney_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChurchObservation" (
    "id" TEXT NOT NULL,
    "journeyId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChurchObservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Course_slug_key" ON "Course"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "CourseTopic_courseId_order_key" ON "CourseTopic"("courseId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "CourseLesson_topicId_order_key" ON "CourseLesson"("topicId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "CourseLessonTask_lessonId_order_key" ON "CourseLessonTask"("lessonId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "CourseCompletion_userId_courseId_key" ON "CourseCompletion"("userId", "courseId");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipJourney_userId_key" ON "MembershipJourney"("userId");

-- CreateIndex
CREATE INDEX "MembershipJourney_stage_idx" ON "MembershipJourney"("stage");

-- CreateIndex
CREATE UNIQUE INDEX "ChurchObservation_journeyId_authorId_key" ON "ChurchObservation"("journeyId", "authorId");

-- AddForeignKey
ALTER TABLE "Group" ADD CONSTRAINT "Group_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupSession" ADD CONSTRAINT "GroupSession_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "CourseLesson"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_prerequisiteId_fkey" FOREIGN KEY ("prerequisiteId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseTopic" ADD CONSTRAINT "CourseTopic_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseLesson" ADD CONSTRAINT "CourseLesson_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "CourseTopic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseLessonTask" ADD CONSTRAINT "CourseLessonTask_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "CourseLesson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseCompletion" ADD CONSTRAINT "CourseCompletion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseCompletion" ADD CONSTRAINT "CourseCompletion_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseCompletion" ADD CONSTRAINT "CourseCompletion_certifiedById_fkey" FOREIGN KEY ("certifiedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipJourney" ADD CONSTRAINT "MembershipJourney_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipJourney" ADD CONSTRAINT "MembershipJourney_interviewerId_fkey" FOREIGN KEY ("interviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipJourney" ADD CONSTRAINT "MembershipJourney_rutaGroupId_fkey" FOREIGN KEY ("rutaGroupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChurchObservation" ADD CONSTRAINT "ChurchObservation_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "MembershipJourney"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChurchObservation" ADD CONSTRAINT "ChurchObservation_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
