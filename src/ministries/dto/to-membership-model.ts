import { Ministry, MinistryMembership, User } from '@prisma/client';
import { toUserModel } from '../../users/dto/to-user-model';
import { MinistryMembershipModel } from './ministry-membership.model';

export function toMembershipModel(
  m: MinistryMembership,
  user: User,
  ministry: Ministry,
): MinistryMembershipModel {
  return {
    id: m.id,
    role: m.role,
    joinedAt: m.joinedAt,
    leftAt: m.leftAt,
    user: toUserModel(user),
    ministry: ministry as MinistryMembershipModel['ministry'],
  };
}
