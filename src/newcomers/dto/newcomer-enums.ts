import { registerEnumType } from '@nestjs/graphql';
import { FollowUpKind, NewcomerInterest, NewcomerStatus } from '@prisma/client';

registerEnumType(NewcomerStatus, { name: 'NewcomerStatus' });
registerEnumType(NewcomerInterest, { name: 'NewcomerInterest' });
registerEnumType(FollowUpKind, { name: 'FollowUpKind' });

export { FollowUpKind, NewcomerInterest, NewcomerStatus };
