import {
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { Public } from '../auth/decorators/public.decorator';
import { RemindersService, TickResult } from './reminders.service';

/**
 * Lo llama Cloud Scheduler cada 15 minutos. No lleva sesión de usuario: se
 * protege con un token compartido en el encabezado X-Cron-Token.
 */
@Controller('internal/notifications')
export class RemindersController {
  constructor(
    private readonly reminders: RemindersService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('tick')
  @HttpCode(200)
  tick(@Headers('x-cron-token') token?: string): Promise<TickResult> {
    const expected = this.config.get<string>('CRON_TOKEN');
    if (!expected)
      throw new ServiceUnavailableException('Los recordatorios no están configurados.');
    const a = Buffer.from(token ?? '');
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ForbiddenException();
    return this.reminders.tick();
  }
}
