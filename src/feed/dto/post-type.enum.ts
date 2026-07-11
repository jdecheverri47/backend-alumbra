import { registerEnumType } from '@nestjs/graphql';
import { PostType } from '@prisma/client';

registerEnumType(PostType, { name: 'PostType' });

export { PostType };
