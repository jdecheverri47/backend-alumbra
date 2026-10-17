import { PrismaClient } from '@prisma/client';

/** Deletes all rows respecting FK order. Shared by every suite that hits the DB. */
export async function wipeDb(prisma: PrismaClient): Promise<void> {
  const tables = [
    'InstituteClass',
    'InstituteSubmission',
    'InstituteAttachment',
    'InstituteItem',
    'InstituteModule',
    'InstituteEnrollment',
    'PostReaction',
    'PostComment',
    'PostImage',
    'PostPollVote',
    'PostPollOption',
    'PostPoll',
    'Post',
    'Event',
    'ChurchObservation',
    'MembershipJourney',
    'CourseEnrollment',
    'AssignmentSubmission',
    'SessionAssignment',
    'SessionMaterial',
    'SessionAttendance',
    'GroupSession',
    'GroupMembership',
    'Group',
    'CourseCompletion',
    'CourseLessonTask',
    'CourseLesson',
    'CourseTopic',
    'Course',
    'NewcomerFollowUp',
    'Newcomer',
    'AccessRequest',
    'Session',
    'MinistryMembership',
    'User',
    'Ministry',
  ];
  for (const table of tables) {
    await prisma.$executeRawUnsafe(`DELETE FROM "${table}"`);
  }
}
