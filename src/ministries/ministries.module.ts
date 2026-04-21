import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { MinistriesResolver } from './ministries.resolver';
import { MinistriesService } from './ministries.service';

@Module({
  imports: [UsersModule],
  providers: [MinistriesResolver, MinistriesService],
  exports: [MinistriesService],
})
export class MinistriesModule {}
