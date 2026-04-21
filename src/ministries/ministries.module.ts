import { Module, forwardRef } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { MinistriesResolver } from './ministries.resolver';
import { MinistriesService } from './ministries.service';

@Module({
  imports: [forwardRef(() => UsersModule)],
  providers: [MinistriesResolver, MinistriesService],
  exports: [MinistriesService],
})
export class MinistriesModule {}
