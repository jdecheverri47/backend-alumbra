import { registerEnumType } from '@nestjs/graphql';
import { GroupSessionStatus } from '@prisma/client';

registerEnumType(GroupSessionStatus, { name: 'GroupSessionStatus' });

export { GroupSessionStatus };
