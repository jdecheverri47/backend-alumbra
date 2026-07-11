import { Course, Group, GroupMembership, User } from '@prisma/client';
import { toUserModel } from '../../users/dto/to-user-model';
import { GroupMembershipModel } from './group-membership.model';
import { GroupModel } from './group.model';

export function toGroupModel(group: Group & { leader: User; course?: Course | null }): GroupModel {
  return {
    id: group.id,
    type: group.type,
    name: group.name,
    description: group.description,
    leader: toUserModel(group.leader),
    course: group.course
      ? { id: group.course.id, slug: group.course.slug, name: group.course.name }
      : null,
    meetingDay: group.meetingDay,
    meetingTime: group.meetingTime,
    location: group.location,
    archivedAt: group.archivedAt,
    createdAt: group.createdAt,
  };
}

export function toGroupMembershipModel(m: GroupMembership & { user: User }): GroupMembershipModel {
  return {
    id: m.id,
    user: toUserModel(m.user),
    joinedAt: m.joinedAt,
    leftAt: m.leftAt,
  };
}
