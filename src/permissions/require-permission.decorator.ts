import { SetMetadata } from '@nestjs/common';

export const REQUIRE_PERMISSION_KEY = 'requirePermission';

/**
 * Exige un permiso para toda la iglesia (ver src/permissions/catalog.ts). Los
 * pastores lo tienen todo. Para permisos con alcance (un ministerio), se
 * comprueba dentro del servicio con PermissionsService.assert.
 */
export const RequirePermission = (permission: string) =>
  SetMetadata(REQUIRE_PERMISSION_KEY, permission);
