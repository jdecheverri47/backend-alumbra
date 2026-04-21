import { Query, Resolver } from '@nestjs/graphql';

@Resolver()
export class AppResolver {
  @Query(() => String, { description: 'Placeholder until the first real queries ship.' })
  apiVersion(): string {
    return '0.0.1';
  }
}
