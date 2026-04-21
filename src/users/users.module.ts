import { Module } from '@nestjs/common';
import { UsersFieldResolver } from './users.field.resolver';
import { UsersResolver } from './users.resolver';
import { UsersService } from './users.service';

@Module({
  providers: [UsersResolver, UsersFieldResolver, UsersService],
  exports: [UsersService],
})
export class UsersModule {}
