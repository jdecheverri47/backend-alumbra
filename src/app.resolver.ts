import { Query, Resolver } from '@nestjs/graphql';
import { Public } from './auth/decorators/public.decorator';

@Resolver()
export class AppResolver {
  @Public()
  @Query(() => String, { description: 'Placeholder until the first real queries ship.' })
  apiVersion(): string {
    return '0.0.1';
  }
}
