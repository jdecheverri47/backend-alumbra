import { ForbiddenException, Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/types/authenticated-user';
import { PERMISSIONS, SYSTEM_ROLES, type ScopeType } from './catalog';

/** Un permiso que alguien tiene, y de dónde le viene. */
export interface Grant {
  permission: string;
  scopeType: ScopeType;
  scopeId: string | null;
  /** "cargo" = por ser coordinador, profesor…; "rol" = asignado en Permisos. */
  source: 'cargo' | 'rol';
  /** Nombre del cargo o del rol, para mostrarlo. */
  via: string;
  bindingId?: string;
}

export interface Scope {
  type: 'MINISTRY' | 'GROUP';
  id: string;
}

const ACOGIDA = 'acogida';
const CACHE_MS = 10_000;

/**
 * Decide quién puede qué. Los pastores, todo. Los demás suman:
 *  - lo que les dan sus cargos (coordinador o ministro, profesor, líder), que
 *    es lo que la plataforma ya hacía antes de existir los permisos; y
 *  - los roles que les asignaron en Permisos, cada uno con su alcance.
 *
 * Un rol dado sobre un ministerio solo aplica los permisos que admiten ese
 * alcance: así no se cuela un permiso de toda la iglesia.
 */
@Injectable()
export class PermissionsService implements OnModuleInit {
  private cache = new Map<string, { grants: Grant[]; at: number }>();

  constructor(private readonly prisma: PrismaService) {}

  /** Los roles predefinidos se sincronizan con el código al arrancar. */
  async onModuleInit(): Promise<void> {
    for (const role of SYSTEM_ROLES) {
      await this.prisma.role.upsert({
        where: { key: role.key },
        create: { ...role, system: true },
        update: {
          name: role.name,
          description: role.description,
          permissions: role.permissions,
          system: true,
          deletedAt: null,
        },
      });
    }
  }

  /** Olvida lo calculado (tras dar o quitar algo). */
  invalidate(userId?: string): void {
    if (userId) this.cache.delete(userId);
    else this.cache.clear();
  }

  async grantsOf(userId: string): Promise<Grant[]> {
    const cached = this.cache.get(userId);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.grants;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        ministryMemberships: { where: { leftAt: null }, include: { ministry: true } },
        instituteEnrollments: { where: { leftAt: null } },
        ledGroups: { where: { archivedAt: null }, select: { id: true }, take: 1 },
        roleBindings: {
          where: { revokedAt: null, role: { deletedAt: null } },
          include: { role: true },
        },
      },
    });
    if (!user || user.deletedAt) return [];

    const grants: Grant[] = [];
    const cargo = (
      permission: string,
      via: string,
      scopeType: ScopeType = 'CHURCH',
      scopeId: string | null = null,
    ) => grants.push({ permission, scopeType, scopeId, source: 'cargo', via });

    // Cargos: lo que ya existía antes de los permisos.
    const member = user.baseRole === 'MIEMBRO';
    for (const m of user.ministryMemberships) {
      if (m.role === 'LEADER') {
        const via = `Coordinador de ${m.ministry.name}`;
        cargo('ministerios.equipo', via, 'MINISTRY', m.ministryId);
        if (member) cargo('muro.publicar', via);
        if (m.ministry.slug === ACOGIDA) {
          for (const p of ['acogida.ver', 'acogida.coordinar', 'accesos.aprobar', 'personas.crear'])
            cargo(p, via);
        }
      } else if (m.ministry.slug === ACOGIDA) {
        cargo('acogida.ver', `Ministro de ${m.ministry.name}`);
      }
    }
    if (member && user.isLeader) cargo('muro.publicar', 'Líder');
    if (member && user.ledGroups.length > 0) cargo('muro.publicar', 'Líder de grupo');
    if (user.instituteEnrollments.some((e) => e.role === 'TEACHER')) {
      cargo('instituto.administrar', 'Profesor del instituto');
    }

    // Roles asignados.
    for (const b of user.roleBindings) {
      for (const permission of b.role.permissions) {
        const def = PERMISSIONS.get(permission);
        if (!def || !def.scopes.includes(b.scopeType)) continue;
        grants.push({
          permission,
          scopeType: b.scopeType,
          scopeId: b.scopeId,
          source: 'rol',
          via: b.role.name,
          bindingId: b.id,
        });
      }
    }

    this.cache.set(userId, { grants, at: Date.now() });
    return grants;
  }

  /** ¿Puede `me` hacer esto? Sin alcance, solo vale lo dado para toda la iglesia. */
  async can(me: AuthenticatedUser, permission: string, scope?: Scope): Promise<boolean> {
    if (me.isPastor) return true;
    const grants = await this.grantsOf(me.sub);
    return grants.some(
      (g) =>
        g.permission === permission &&
        (g.scopeType === 'CHURCH' ||
          (scope && g.scopeType === scope.type && g.scopeId === scope.id)),
    );
  }

  async assert(
    me: AuthenticatedUser,
    permission: string,
    scope?: Scope,
    message?: string,
  ): Promise<void> {
    if (await this.can(me, permission, scope)) return;
    throw new ForbiddenException({
      error: 'FORBIDDEN',
      message:
        message ??
        `No tienes permiso para esto (${PERMISSIONS.get(permission)?.label ?? permission}).`,
    });
  }
}
