import { Field, ID, InputType, Int, ObjectType } from '@nestjs/graphql';
import { UserModel } from '../../users/dto/user.model';

@ObjectType('PermissionDef')
export class PermissionDefModel {
  @Field()
  key!: string;

  @Field()
  label!: string;

  @Field()
  description!: string;

  @Field(() => [String], { description: 'CHURCH, MINISTRY…: sobre qué se puede dar.' })
  scopes!: string[];
}

@ObjectType('PermissionModule')
export class PermissionModuleModel {
  @Field()
  key!: string;

  @Field()
  label!: string;

  @Field(() => [PermissionDefModel])
  permissions!: PermissionDefModel[];
}

@ObjectType('Role')
export class RoleModel {
  @Field(() => ID)
  id!: string;

  @Field()
  key!: string;

  @Field()
  name!: string;

  @Field(() => String, { nullable: true })
  description?: string | null;

  @Field(() => [String])
  permissions!: string[];

  @Field({ description: 'Predefinido: no se edita.' })
  system!: boolean;

  @Field(() => Int)
  bindingCount!: number;
}

@ObjectType('Grant')
export class GrantModel {
  @Field()
  permission!: string;

  @Field()
  scopeType!: string;

  @Field(() => String, { nullable: true })
  scopeId?: string | null;

  @Field(() => String, { nullable: true, description: 'Nombre del ministerio o grupo.' })
  scopeName?: string | null;

  @Field({ description: '"cargo" o "rol".' })
  source!: string;

  @Field()
  via!: string;

  @Field(() => String, { nullable: true })
  bindingId?: string | null;
}

@ObjectType('MyPermissions')
export class MyPermissionsModel {
  @Field({ description: 'Pastor: lo puede todo.' })
  all!: boolean;

  @Field(() => [GrantModel])
  grants!: GrantModel[];
}

@ObjectType('RoleBinding')
export class RoleBindingModel {
  @Field(() => ID)
  id!: string;

  @Field(() => UserModel)
  user!: UserModel;

  @Field(() => RoleModel)
  role!: RoleModel;

  @Field()
  scopeType!: string;

  @Field(() => String, { nullable: true })
  scopeId?: string | null;

  @Field(() => String, { nullable: true })
  scopeName?: string | null;

  @Field(() => UserModel)
  grantedBy!: UserModel;

  @Field(() => Date)
  createdAt!: Date;
}

@ObjectType('PermissionAuditEntry')
export class PermissionAuditModel {
  @Field(() => ID)
  id!: string;

  @Field(() => UserModel)
  actor!: UserModel;

  @Field()
  action!: string;

  @Field()
  summary!: string;

  @Field(() => Date)
  createdAt!: Date;
}

@InputType()
export class RoleInput {
  @Field()
  name!: string;

  @Field(() => String, { nullable: true })
  description?: string | null;

  @Field(() => [String])
  permissions!: string[];
}

@InputType()
export class GrantRoleInput {
  @Field(() => ID)
  userId!: string;

  @Field(() => ID)
  roleId!: string;

  @Field({ defaultValue: 'CHURCH', description: 'CHURCH, MINISTRY o GROUP.' })
  scopeType!: string;

  @Field(() => ID, { nullable: true })
  scopeId?: string | null;
}
