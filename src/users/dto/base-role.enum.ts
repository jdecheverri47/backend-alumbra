import { registerEnumType } from '@nestjs/graphql';
import { BaseRole } from '@prisma/client';

registerEnumType(BaseRole, { name: 'BaseRole' });

export { BaseRole };
