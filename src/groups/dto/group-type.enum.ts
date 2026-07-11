import { registerEnumType } from '@nestjs/graphql';
import { GroupType } from '@prisma/client';

registerEnumType(GroupType, { name: 'GroupType' });

export { GroupType };
