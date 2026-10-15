import { Module } from '@nestjs/common';
import { NewcomersResolver } from './newcomers.resolver';
import { NewcomersService } from './newcomers.service';

@Module({
  providers: [NewcomersResolver, NewcomersService],
})
export class NewcomersModule {}
