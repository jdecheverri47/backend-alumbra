import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PermissionGuard } from './permission.guard';
import { PermissionsAdminService } from './permissions-admin.service';
import { PermissionsResolver } from './permissions.resolver';
import { PermissionsService } from './permissions.service';

/**
 * Global: cualquier módulo pregunta `permissions.can(...)`. El guard corre
 * después del de autenticación (AuthModule se importa antes en AppModule).
 */
@Global()
@Module({
  providers: [
    PermissionsService,
    PermissionsAdminService,
    PermissionsResolver,
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
  exports: [PermissionsService],
})
export class PermissionsModule {}
