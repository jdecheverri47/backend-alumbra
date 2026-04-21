import { Module, forwardRef } from '@nestjs/common';
import { MinistriesModule } from '../ministries/ministries.module';
import { UsersFieldResolver } from './users.field.resolver';
import { UsersResolver } from './users.resolver';
import { UsersService } from './users.service';

@Module({
  imports: [forwardRef(() => MinistriesModule)],
  providers: [UsersResolver, UsersFieldResolver, UsersService],
  exports: [UsersService],
})
export class UsersModule {}
