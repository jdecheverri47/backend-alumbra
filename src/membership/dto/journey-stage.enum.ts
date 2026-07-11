import { registerEnumType } from '@nestjs/graphql';
import { JourneyStage } from '@prisma/client';

registerEnumType(JourneyStage, { name: 'JourneyStage' });

export { JourneyStage };
