import { registerEnumType } from '@nestjs/graphql';
import { PostMediaKind } from '@prisma/client';

registerEnumType(PostMediaKind, { name: 'PostMediaKind' });

export { PostMediaKind };
