import { registerEnumType } from '@nestjs/graphql';
import { ReactionType } from '@prisma/client';

registerEnumType(ReactionType, { name: 'ReactionType' });

export { ReactionType };
