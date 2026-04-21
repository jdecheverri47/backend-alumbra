import { registerEnumType } from '@nestjs/graphql';
import { MinistryRole } from '@prisma/client';

registerEnumType(MinistryRole, { name: 'MinistryRole' });

export { MinistryRole };
