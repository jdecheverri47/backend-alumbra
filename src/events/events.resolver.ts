import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { CreateEventInput } from './dto/create-event.input';
import { EventModel } from './dto/event.model';
import { PublicEventModel } from './dto/public-event.model';
import { toEventModel } from './dto/to-event-model';
import { toPublicEventModel } from './dto/to-public-event-model';
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

  /**
   * Sin sesión: es la cartelera del sitio web. Devuelve `PublicEvent`, que solo
   * tiene escalares — ver la nota en public-event.model.ts.
   */
  @Public()
  @Query(() => [PublicEventModel], {
    description: 'Eventos generales publicables en el rango [from, to]. No requiere sesión.',
  })
  async publicEvents(
    @Args('from', { type: () => Date }) from: Date,
    @Args('to', { type: () => Date }) to: Date,
  ): Promise<PublicEventModel[]> {
    const rows = await this.eventsService.listPublic(from, to);
    return rows.map(toPublicEventModel);
  }

  /**
   * La otra mitad de la cartelera: lo anunciado sin fecha ("bautizos, fecha por
   * confirmar"). Va en una consulta aparte porque no tiene rango que pedirle.
   */
  @Public()
  @Query(() => [PublicEventModel], {
    description: 'Eventos generales publicables sin fecha definida. No requiere sesión.',
  })
  async publicUndatedEvents(): Promise<PublicEventModel[]> {
    const rows = await this.eventsService.listPublicUndated();
    return rows.map(toPublicEventModel);
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
