import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { CreateEventInput } from './dto/create-event.input';
import { EventModel } from './dto/event.model';
import { toEventModel } from './dto/to-event-model';
import { UpdateEventInput } from './dto/update-event.input';
import { EventsService } from './events.service';

@Resolver(() => EventModel)
export class EventsResolver {
  constructor(private readonly eventsService: EventsService) {}

  @Query(() => [EventModel], { description: 'Eventos visibles para mí en el rango [from, to].' })
  async events(
    @Args('from', { type: () => Date }) from: Date,
    @Args('to', { type: () => Date }) to: Date,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<EventModel[]> {
    const rows = await this.eventsService.listVisible(me, from, to);
    return rows.map(toEventModel);
  }

  @Query(() => [EventModel], {
    description: 'Eventos anunciados sin fecha definida, visibles para mí.',
  })
  async undatedEvents(@CurrentUser() me: AuthenticatedUser): Promise<EventModel[]> {
    const rows = await this.eventsService.listUndated(me);
    return rows.map(toEventModel);
  }

  // General: solo pastores. De grupo: pastor o líder del grupo (validado en el service).
  @Mutation(() => EventModel)
  async createEvent(
    @Args('input') input: CreateEventInput,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<EventModel> {
    return toEventModel(await this.eventsService.create(me, input));
  }

  // Creador o pastor (validado en el service).
  @Mutation(() => EventModel)
  async updateEvent(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateEventInput,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<EventModel> {
    return toEventModel(await this.eventsService.updateById(me, id, input));
  }

  // Creador o pastor (validado en el service).
  @Mutation(() => EventModel)
  async deleteEvent(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() me: AuthenticatedUser,
  ): Promise<EventModel> {
    return toEventModel(await this.eventsService.deleteById(me, id));
  }
}
