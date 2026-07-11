import { BaseRole, User } from '@prisma/client';

export interface AuthenticatedUser {
  sub: string;
  email: string;
  isPastor: boolean;
  baseRole: BaseRole;
  /** Full row loaded by the guard — avoids a refetch in most resolvers. */
  user: User;
}
