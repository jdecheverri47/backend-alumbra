/**
 * El catálogo de permisos de la plataforma. Cada acción protegida tiene uno;
 * un rol es un conjunto de ellos (ver Role en el esquema).
 *
 * `scopes` dice sobre qué se puede dar: CHURCH (toda la iglesia) siempre;
 * MINISTRY si tiene sentido darlo para un ministerio concreto.
 */
export type ScopeType = 'CHURCH' | 'MINISTRY' | 'GROUP';

export interface PermissionDef {
  key: string;
  label: string;
  description: string;
  scopes: ScopeType[];
}

export interface PermissionModule {
  key: string;
  label: string;
  permissions: PermissionDef[];
}

export const PERMISSION_MODULES: PermissionModule[] = [
  {
    key: 'personas',
    label: 'Personas',
    permissions: [
      {
        key: 'personas.crear',
        label: 'Agregar personas',
        description: 'Crear cuentas una por una.',
        scopes: ['CHURCH'],
      },
      {
        key: 'personas.importar',
        label: 'Importar personas',
        description: 'Cargar miembros y asistentes desde una hoja de cálculo.',
        scopes: ['CHURCH'],
      },
      {
        key: 'personas.editar',
        label: 'Editar perfiles',
        description: 'Cambiar los datos del perfil de cualquier persona.',
        scopes: ['CHURCH'],
      },
      {
        key: 'personas.administrar',
        label: 'Administrar cuentas',
        description:
          'Habilitar o quitar el acceso, membresía, bautismo, líderes y eliminar cuentas.',
        scopes: ['CHURCH'],
      },
      {
        key: 'accesos.aprobar',
        label: 'Aprobar solicitudes de acceso',
        description: 'Aprobar o rechazar a quien pide entrar con Google.',
        scopes: ['CHURCH'],
      },
    ],
  },
  {
    key: 'muro',
    label: 'Muro y calendario',
    permissions: [
      {
        key: 'muro.publicar',
        label: 'Publicar en el muro',
        description: 'Escribir publicaciones (comentar y reaccionar lo puede hacer cualquiera).',
        scopes: ['CHURCH'],
      },
      {
        key: 'muro.anunciar',
        label: 'Publicar anuncios',
        description: 'Publicar anuncios oficiales.',
        scopes: ['CHURCH'],
      },
      {
        key: 'muro.fijar',
        label: 'Fijar anuncios',
        description: 'Fijar y desfijar anuncios arriba del muro.',
        scopes: ['CHURCH'],
      },
      {
        key: 'muro.moderar',
        label: 'Moderar el muro',
        description: 'Borrar publicaciones y comentarios de otros.',
        scopes: ['CHURCH'],
      },
      {
        key: 'calendario.eventos_generales',
        label: 'Crear eventos generales',
        description: 'Eventos para toda la iglesia (los de un grupo los crea su líder).',
        scopes: ['CHURCH'],
      },
    ],
  },
  {
    key: 'ministerios',
    label: 'Ministerios',
    permissions: [
      {
        key: 'ministerios.administrar',
        label: 'Administrar ministerios',
        description: 'Crear y editar ministerios y nombrar coordinadores.',
        scopes: ['CHURCH'],
      },
      {
        key: 'ministerios.equipo',
        label: 'Armar el equipo',
        description: 'Sumar y sacar ministros.',
        scopes: ['CHURCH', 'MINISTRY'],
      },
      {
        key: 'acogida.ver',
        label: 'Acogida: personas nuevas',
        description: 'Ver y registrar personas nuevas y dejar observaciones.',
        scopes: ['CHURCH'],
      },
      {
        key: 'acogida.coordinar',
        label: 'Acogida: coordinar',
        description: 'Repartir personas nuevas entre el equipo y borrar registros.',
        scopes: ['CHURCH'],
      },
    ],
  },
  {
    key: 'instituto',
    label: 'Instituto Bíblico',
    permissions: [
      {
        key: 'instituto.administrar',
        label: 'Administrar el instituto',
        description: 'Publicar clases y tareas, programar clases, calificar e inscribir alumnos.',
        scopes: ['CHURCH'],
      },
      {
        key: 'instituto.profesores',
        label: 'Nombrar profesores',
        description: 'Dar o quitar el rol de profesor.',
        scopes: ['CHURCH'],
      },
    ],
  },
  {
    key: 'permisos',
    label: 'Permisos',
    permissions: [
      {
        key: 'permisos.administrar',
        label: 'Administrar permisos',
        description: 'Crear roles y dar o quitar permisos a otras personas.',
        scopes: ['CHURCH'],
      },
    ],
  },
];

export const PERMISSIONS = new Map(
  PERMISSION_MODULES.flatMap((m) => m.permissions.map((p) => [p.key, p] as const)),
);

export type PermissionKey = string;

/** Roles predefinidos: se pueden asignar, pero no editar. */
export const SYSTEM_ROLES: Array<{
  key: string;
  name: string;
  description: string;
  permissions: string[];
}> = [
  {
    key: 'administrador-personas',
    name: 'Administrador de personas',
    description: 'Secretaría: agrega, importa y edita personas y aprueba accesos.',
    permissions: [
      'personas.crear',
      'personas.importar',
      'personas.editar',
      'personas.administrar',
      'accesos.aprobar',
    ],
  },
  {
    key: 'comunicaciones',
    name: 'Comunicaciones',
    description: 'Publica y fija anuncios, modera el muro y crea eventos generales.',
    permissions: [
      'muro.publicar',
      'muro.anunciar',
      'muro.fijar',
      'muro.moderar',
      'calendario.eventos_generales',
    ],
  },
  {
    key: 'coordinador-ministerio',
    name: 'Coordinador de ministerio',
    description: 'Arma el equipo de un ministerio. Se da sobre el ministerio.',
    permissions: ['ministerios.equipo'],
  },
  {
    key: 'coordinador-acogida',
    name: 'Coordinador de Acogida',
    description: 'Registra y reparte a las personas nuevas y aprueba accesos.',
    permissions: ['acogida.ver', 'acogida.coordinar', 'accesos.aprobar', 'personas.crear'],
  },
  {
    key: 'equipo-acogida',
    name: 'Equipo de Acogida',
    description: 'Registra personas nuevas y deja observaciones.',
    permissions: ['acogida.ver'],
  },
  {
    key: 'director-instituto',
    name: 'Director del instituto',
    description: 'Administra el Instituto Bíblico y nombra profesores.',
    permissions: ['instituto.administrar', 'instituto.profesores'],
  },
  {
    key: 'administrador-permisos',
    name: 'Administrador de permisos',
    description: 'Crea roles y da o quita permisos (no hace pastor a nadie).',
    permissions: ['permisos.administrar'],
  },
];
