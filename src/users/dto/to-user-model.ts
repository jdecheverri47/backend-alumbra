import { User } from '@prisma/client';
import { UserModel } from './user.model';

export function toUserModel(user: User): UserModel {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    fullName: `${user.firstName} ${user.lastName}`,
    baseRole: user.baseRole,
    isPastor: user.isPastor,
    isLeader: user.isLeader,
    canSignIn: user.canSignIn,
    phone: user.phone,
    photoUrl: user.photoUrl,
    coverUrl: user.coverUrl,
    birthDate: user.birthDate,
    membershipDate: user.membershipDate,
    baptismDate: user.baptismDate,
    createdAt: user.createdAt,
  };
}
