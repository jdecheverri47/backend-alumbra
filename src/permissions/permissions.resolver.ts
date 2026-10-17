import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { PERMISSION_MODULES } from './catalog';
import {
  GrantRoleInput,
  MyPermissionsModel,
  PermissionAuditModel,
  PermissionModuleModel,
  RoleBindingModel,
  RoleInput,
  RoleModel,
} from './dto/permissions.models';
import { PermissionsAdminService } from './permissions-admin.service';
import { PermissionsService } from './permissions.service';
import { RequirePermission } from './require-permission.decorator';

const ADMIN = 'permisos.administrar';

@Resolver()
export class PermissionsResolver {
  constructor(
    private readonly permissions: PermissionsService,
    private readonly admin: PermissionsAdminService,
  ) {}

  @Query(() => [PermissionModuleModel], { description: 'Todos los permisos, por módulo.' })
  permissionCatalog(): PermissionModuleModel[] {
    return PERMISSION_MODULES;
  }

  @Query(() => MyPermissionsModel, { description: 'Lo que puede hacer quien consulta.' })
  async myPermissions(@CurrentUser() me: AuthenticatedUser): Promise<MyPermissionsModel> {
    return {
      all: me.isPastor,
      grants: await this.admin.withNames(await this.permissions.grantsOf(me.sub)),
    };
  }

  @RequirePermission(ADMIN)
  @Query(() => [RoleModel])
  roles(): Promise<RoleModel[]> {
    return this.admin.roles();
  }

  @RequirePermission(ADMIN)
  @Query(() => [RoleBindingModel], { description: 'Roles asignados (de una persona, o todos).' })
  roleBindings(
    @Args('userId', { type: () => ID, nullable: true }) userId?: string,
  ): Promise<RoleBindingModel[]> {
    return this.admin.bindings(userId);
  }

  @RequirePermission(ADMIN)
  @Query(() => MyPermissionsModel, {
    description: 'Lo que puede hacer una persona y de dónde le viene.',
  })
  userAccess(@Args('userId', { type: () => ID }) userId: string): Promise<MyPermissionsModel> {
    return this.admin.access(userId);
  }

  @RequirePermission(ADMIN)
  @Query(() => [PermissionAuditModel])
  permissionAudit(
    @Args('limit', { type: () => Int, defaultValue: 50 }) limit: number,
  ): Promise<PermissionAuditModel[]> {
    return this.admin.auditLog(limit);
  }

  @RequirePermission(ADMIN)
  @Mutation(() => RoleModel)
  createRole(
    @CurrentUser() me: AuthenticatedUser,
    @Args('input') input: RoleInput,
  ): Promise<RoleModel> {
    return this.admin.createRole(me, input);
  }

  @RequirePermission(ADMIN)
  @Mutation(() => RoleModel)
  updateRole(
    @CurrentUser() me: AuthenticatedUser,
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: RoleInput,
  ): Promise<RoleModel> {
    return this.admin.updateRole(me, id, input);
  }

  @RequirePermission(ADMIN)
  @Mutation(() => Boolean)
  deleteRole(
    @CurrentUser() me: AuthenticatedUser,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<boolean> {
    return this.admin.deleteRole(me, id);
  }

  @RequirePermission(ADMIN)
  @Mutation(() => RoleBindingModel)
  grantRole(
    @CurrentUser() me: AuthenticatedUser,
    @Args('input') input: GrantRoleInput,
  ): Promise<RoleBindingModel> {
    return this.admin.grant(me, input);
  }

  @RequirePermission(ADMIN)
  @Mutation(() => Boolean)
  revokeRoleBinding(
    @CurrentUser() me: AuthenticatedUser,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<boolean> {
    return this.admin.revoke(me, id);
  }
}
