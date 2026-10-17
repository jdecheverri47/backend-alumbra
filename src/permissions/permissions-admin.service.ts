import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PermissionScope, Prisma, Role, User } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';
import { toUserModel } from '../users/dto/to-user-model';
import { PERMISSIONS } from './catalog';
import {
  GrantModel,
  PermissionAuditModel,
  RoleBindingModel,
  RoleModel,
} from './dto/permissions.models';
import { Grant, PermissionsService } from './permissions.service';

const roleSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).nullish(),
  permissions: z
    .array(z.string())
    .min(1, 'El rol necesita al menos un permiso.')
    .refine((ps) => ps.every((p) => PERMISSIONS.has(p)), 'Hay permisos que no existen.'),
});

const grantSchema = z
  .object({
    userId: z.string().min(1),
    roleId: z.string().min(1),
    scopeType: z.enum(['CHURCH', 'MINISTRY', 'GROUP']),
    scopeId: z.string().nullish(),
  })
  .refine((g) => (g.scopeType === 'CHURCH') === !g.scopeId, {
    message: 'Para un ministerio o grupo hay que elegir cuál; para toda la iglesia, ninguno.',
  });

const fullName = (u: Pick<User, 'firstName' | 'lastName'>) => `${u.firstName} ${u.lastName}`;

/**
 * La pantalla de Permisos: roles personalizados, asignaciones e historial.
 * Todo exige `permisos.administrar` (el resolver lo comprueba). Hacer pastor a
 * alguien no pasa por aquí: sigue siendo cosa de pastores.
 */
@Injectable()
export class PermissionsAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  private async scopeNames(refs: Array<{ scopeType: string; scopeId?: string | null }>) {
    const ministryIds = refs
      .filter((r) => r.scopeType === 'MINISTRY' && r.scopeId)
      .map((r) => r.scopeId!);
    const groupIds = refs
      .filter((r) => r.scopeType === 'GROUP' && r.scopeId)
      .map((r) => r.scopeId!);
    const [ministries, groups] = await Promise.all([
      ministryIds.length
        ? this.prisma.ministry.findMany({
            where: { id: { in: ministryIds } },
            select: { id: true, name: true },
          })
        : [],
      groupIds.length
        ? this.prisma.group.findMany({
            where: { id: { in: groupIds } },
            select: { id: true, name: true },
          })
        : [],
    ]);
    return new Map([...ministries, ...groups].map((x) => [x.id, x.name]));
  }

  private scopeLabel(scopeType: string, name?: string | null): string {
    if (scopeType === 'CHURCH') return 'toda la iglesia';
    return scopeType === 'MINISTRY' ? `el ministerio ${name ?? '?'}` : `el grupo ${name ?? '?'}`;
  }

  private async audit(
    actorId: string,
    action: string,
    summary: string,
    details?: Prisma.InputJsonValue,
  ) {
    await this.prisma.permissionAudit.create({ data: { actorId, action, summary, details } });
  }

  private toRole(role: Role, bindingCount = 0): RoleModel {
    return {
      id: role.id,
      key: role.key,
      name: role.name,
      description: role.description,
      permissions: role.permissions,
      system: role.system,
      bindingCount,
    };
  }

  async roles(): Promise<RoleModel[]> {
    const rows = await this.prisma.role.findMany({
      where: { deletedAt: null },
      include: { _count: { select: { bindings: { where: { revokedAt: null } } } } },
      orderBy: [{ system: 'desc' }, { name: 'asc' }],
    });
    return rows.map((r) => this.toRole(r, r._count.bindings));
  }

  async createRole(me: AuthenticatedUser, raw: unknown): Promise<RoleModel> {
    const data = roleSchema.parse(raw);
    const role = await this.prisma.role.create({
      data: { ...data, key: `personalizado-${randomUUID().slice(0, 8)}`, system: false },
    });
    await this.audit(me.sub, 'ROLE_CREATE', `Creó el rol ${role.name}`, {
      permissions: role.permissions,
    });
    return this.toRole(role);
  }

  async updateRole(me: AuthenticatedUser, id: string, raw: unknown): Promise<RoleModel> {
    const data = roleSchema.parse(raw);
    const current = await this.prisma.role.findFirst({ where: { id, deletedAt: null } });
    if (!current) throw new NotFoundException(`Role ${id} not found.`);
    if (current.system) throw new BadRequestException('Los roles predefinidos no se editan.');
    const role = await this.prisma.role.update({ where: { id }, data });
    this.permissions.invalidate();
    await this.audit(me.sub, 'ROLE_UPDATE', `Editó el rol ${role.name}`, {
      before: current.permissions,
      after: role.permissions,
    });
    return this.toRole(role);
  }

  /** Borrar un rol personalizado quita también sus asignaciones. */
  async deleteRole(me: AuthenticatedUser, id: string): Promise<boolean> {
    const role = await this.prisma.role.findFirst({ where: { id, deletedAt: null } });
    if (!role) throw new NotFoundException(`Role ${id} not found.`);
    if (role.system) throw new BadRequestException('Los roles predefinidos no se borran.');
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.roleBinding.updateMany({
        where: { roleId: id, revokedAt: null },
        data: { revokedAt: now },
      }),
      this.prisma.role.update({ where: { id }, data: { deletedAt: now } }),
    ]);
    this.permissions.invalidate();
    await this.audit(me.sub, 'ROLE_DELETE', `Borró el rol ${role.name}`);
    return true;
  }

  async bindings(userId?: string): Promise<RoleBindingModel[]> {
    const rows = await this.prisma.roleBinding.findMany({
      where: {
        revokedAt: null,
        role: { deletedAt: null },
        user: { deletedAt: null },
        ...(userId ? { userId } : {}),
      },
      include: { user: true, role: true, grantedBy: true },
      orderBy: { createdAt: 'desc' },
    });
    const names = await this.scopeNames(rows);
    return rows.map((b) => ({
      id: b.id,
      user: toUserModel(b.user),
      role: this.toRole(b.role),
      scopeType: b.scopeType,
      scopeId: b.scopeId,
      scopeName: b.scopeId ? (names.get(b.scopeId) ?? null) : null,
      grantedBy: toUserModel(b.grantedBy),
      createdAt: b.createdAt,
    }));
  }

  async grant(me: AuthenticatedUser, raw: unknown): Promise<RoleBindingModel> {
    const data = grantSchema.parse(raw);
    const [user, role] = await Promise.all([
      this.prisma.user.findFirst({ where: { id: data.userId, deletedAt: null } }),
      this.prisma.role.findFirst({ where: { id: data.roleId, deletedAt: null } }),
    ]);
    if (!user) throw new NotFoundException('Esa persona no existe.');
    if (!role) throw new NotFoundException('Ese rol no existe.');

    let scopeName: string | null = null;
    if (data.scopeType === 'MINISTRY') {
      const m = await this.prisma.ministry.findFirst({
        where: { id: data.scopeId!, archivedAt: null },
      });
      if (!m) throw new NotFoundException('Ese ministerio no existe.');
      scopeName = m.name;
    } else if (data.scopeType === 'GROUP') {
      const g = await this.prisma.group.findFirst({
        where: { id: data.scopeId!, archivedAt: null },
      });
      if (!g) throw new NotFoundException('Ese grupo no existe.');
      scopeName = g.name;
    }
    // Un rol sobre un ministerio solo aplica los permisos que lo admiten.
    const applicable = role.permissions.filter((p) =>
      PERMISSIONS.get(p)?.scopes.includes(data.scopeType),
    );
    if (applicable.length === 0) {
      throw new BadRequestException({
        error: 'SCOPE_NOT_APPLICABLE',
        message: `Ningún permiso de "${role.name}" se puede dar sobre ${this.scopeLabel(data.scopeType, scopeName)}.`,
      });
    }
    const duplicate = await this.prisma.roleBinding.findFirst({
      where: {
        userId: user.id,
        roleId: role.id,
        scopeType: data.scopeType as PermissionScope,
        scopeId: data.scopeId ?? null,
        revokedAt: null,
      },
    });
    if (duplicate) throw new ConflictException(`${fullName(user)} ya tiene ese rol ahí.`);

    const binding = await this.prisma.roleBinding.create({
      data: {
        userId: user.id,
        roleId: role.id,
        scopeType: data.scopeType as PermissionScope,
        scopeId: data.scopeId ?? null,
        grantedById: me.sub,
      },
      include: { user: true, role: true, grantedBy: true },
    });
    this.permissions.invalidate(user.id);
    await this.audit(
      me.sub,
      'GRANT',
      `Dio el rol ${role.name} a ${fullName(user)} sobre ${this.scopeLabel(data.scopeType, scopeName)}`,
      { bindingId: binding.id, userId: user.id, roleId: role.id },
    );
    return {
      id: binding.id,
      user: toUserModel(binding.user),
      role: this.toRole(binding.role),
      scopeType: binding.scopeType,
      scopeId: binding.scopeId,
      scopeName,
      grantedBy: toUserModel(binding.grantedBy),
      createdAt: binding.createdAt,
    };
  }

  async revoke(me: AuthenticatedUser, bindingId: string): Promise<boolean> {
    const binding = await this.prisma.roleBinding.findFirst({
      where: { id: bindingId, revokedAt: null },
      include: { user: true, role: true },
    });
    if (!binding) throw new NotFoundException('Esa asignación no existe.');
    await this.prisma.roleBinding.update({
      where: { id: bindingId },
      data: { revokedAt: new Date() },
    });
    this.permissions.invalidate(binding.userId);
    const names = await this.scopeNames([binding]);
    await this.audit(
      me.sub,
      'REVOKE',
      `Quitó el rol ${binding.role.name} a ${fullName(binding.user)} sobre ${this.scopeLabel(binding.scopeType, binding.scopeId ? names.get(binding.scopeId) : null)}`,
      { bindingId, userId: binding.userId, roleId: binding.roleId },
    );
    return true;
  }

  /** Todo lo que alguien puede hacer y de dónde le viene (cargo o rol). */
  async access(userId: string): Promise<{ all: boolean; grants: GrantModel[] }> {
    const user = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (!user) throw new NotFoundException('Esa persona no existe.');
    return {
      all: user.isPastor,
      grants: await this.withNames(await this.permissions.grantsOf(userId)),
    };
  }

  async withNames(grants: Grant[]): Promise<GrantModel[]> {
    const names = await this.scopeNames(grants);
    return grants.map((g) => ({
      ...g,
      scopeName: g.scopeId ? (names.get(g.scopeId) ?? null) : null,
      bindingId: g.bindingId ?? null,
    }));
  }

  async auditLog(limit: number): Promise<PermissionAuditModel[]> {
    const rows = await this.prisma.permissionAudit.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
      include: { actor: true },
    });
    return rows.map((r) => ({
      id: r.id,
      actor: toUserModel(r.actor),
      action: r.action,
      summary: r.summary,
      createdAt: r.createdAt,
    }));
  }
}
