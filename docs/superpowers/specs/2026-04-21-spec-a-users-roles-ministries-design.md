# Spec A — Núcleo de usuarios, roles y ministerios

**Fecha:** 2026-04-21
**Estado:** Aprobado
**Depende de:** `2026-04-21-backend-scaffold-design.md`

## Contexto

Alumbra es una aplicación para una iglesia (single-tenant). El modelo de dominio se implementa en tres specs incrementales:

- **Spec A** (este): usuarios, rol base, pastor, ministerios.
- **Spec B**: pipeline de prospecto → miembro (entrevistas, ruta de crecimiento, asistencias, evaluaciones, decisión de iglesia, pacto).
- **Spec C**: grupos presenciales (madurez/conexión) y cursos asíncronos (Google Classroom).

Spec A es el cimiento — todos los demás cuelgan de `User` y `Ministry`.

## Decisiones de dominio (tomadas en brainstorming)

- **Tenancy:** single-tenant. No hay modelo `Church`/`Organization`.
- **Rol base del usuario:** `ASISTENTE` o `MIEMBRO`. Los asistentes tienen acceso a grupos de conexión; los miembros a grupos de madurez. La transición `ASISTENTE → MIEMBRO` ocurre a través del pipeline de Spec B, no directamente.
- **Pastor:** es un flag `isPastor` sobre `User`. Un pastor es siempre miembro (se asume implícitamente).
- **Líder / Maestro:** **no se modelan** en Spec A. Son capacidades derivadas de relaciones que existirán en Spec C (`Group.leaderId`, `Course.teacherId`). Modelarlas ahora sin esas entidades sería especulativo.
- **Ministerios:** modelo genérico. Spec A incluye seed solo del ministerio `Acogida`. El resto (alabanza, jóvenes, etc.) los crean los pastores cuando se definan.

## Modelos

### `User`

```prisma
model User {
  id        String   @id @default(cuid())
  email     String   @unique
  firstName String
  lastName  String
  baseRole  BaseRole @default(ASISTENTE)
  isPastor  Boolean  @default(false)

  phone     String?
  photoUrl  String?
  googleId  String?  @unique
  birthDate DateTime?

  ministryMemberships MinistryMembership[]

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  @@index([deletedAt])
}

enum BaseRole {
  ASISTENTE
  MIEMBRO
}
```

Notas:
- `email` es el identificador principal. Se normaliza a lowercase en el servicio antes de persistir.
- `googleId` es nullable porque la auth con Google OAuth se introduce en una sesión posterior. Cuando exista, el login rellenará este campo.
- `deletedAt` = soft delete. Borrar un usuario físicamente rompería histórico de entrevistas, asistencias y evaluaciones (que llegan en Spec B). El filtrado por `deletedAt IS NULL` se hace con un middleware de Prisma (ver más abajo).

### `Ministry`

```prisma
model Ministry {
  id          String   @id @default(cuid())
  slug        String   @unique
  name        String
  description String?

  memberships MinistryMembership[]

  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt
  archivedAt DateTime?
}
```

Notas:
- `slug` es estable (`"acogida"`, `"alabanza"`) y permite referenciar ministerios desde código sin depender de ids. Se valida como kebab-case.
- `archivedAt` en lugar de borrado físico: un ministerio archivado no aparece en listados por defecto pero conserva sus memberships para histórico.

### `MinistryMembership`

```prisma
model MinistryMembership {
  id         String       @id @default(cuid())
  userId     String
  ministryId String
  role       MinistryRole @default(MEMBER)
  joinedAt   DateTime     @default(now())
  leftAt     DateTime?

  user     User     @relation(fields: [userId], references: [id])
  ministry Ministry @relation(fields: [ministryId], references: [id])

  @@unique([userId, ministryId, joinedAt])
  @@index([ministryId])
  @@index([userId])
}

enum MinistryRole {
  LEADER
  MEMBER
}
```

Notas:
- `@@unique([userId, ministryId, joinedAt])` permite que un usuario reingrese al mismo ministerio en otra fecha. El par `(userId, ministryId)` sin fecha sería demasiado restrictivo.
- `leftAt` nullable: un membership activo tiene `leftAt IS NULL`. "Quitar" un miembro no borra la fila, setea `leftAt`.
- Índices cubren las queries típicas: listar miembros activos de un ministerio; listar ministerios activos de un usuario.

## Soft delete middleware

Se añade un middleware a `PrismaService` que intercepta queries sobre `User`:

- `findUnique` / `findFirst` / `findMany`: inyecta `where: { deletedAt: null }` si no se pasa explícitamente `includeDeleted: true` en un contexto específico.
- `delete` / `deleteMany` sobre `User`: se intercepta y convierte en `update` que setea `deletedAt = new Date()`.

Esto centraliza la lógica y evita tener que acordarse del filtro en cada resolver.

Alternativa considerada: extender los modelos con views SQL. Rechazada: complica las migraciones y no aporta sobre el middleware.

## Reglas de negocio (enforce en capa de servicio)

La capa de autorización formal llega con auth. Por ahora documentamos las reglas como comentarios/validaciones en los servicios, para que cuando se conecte auth se encapsulen en guards:

1. Un `User` con `isPastor = true` solo puede ser creado/modificado por otro pastor. **Bootstrap:** el primer pastor se crea fuera de GraphQL, mediante un script CLI (`scripts/create-pastor.ts`) que lee email desde argumentos.
2. Solo pastores crean/archivan ministerios.
3. Solo pastores y líderes del ministerio (`MinistryRole.LEADER`) pueden añadir/quitar miembros a ese ministerio.
4. `baseRole` no muta directamente vía mutation pública en Spec A. Cambiará a través del pipeline de Spec B. Si hace falta una corrección manual por un pastor, se hace con un script administrativo, no con una mutation pública — para evitar abrir un boquete antes de que exista el pipeline formal.
5. `email` es case-insensitive a efectos de unicidad: siempre se almacena en lowercase.

## API GraphQL

### Tipos

```graphql
enum BaseRole { ASISTENTE MIEMBRO }
enum MinistryRole { LEADER MEMBER }

type User {
  id: ID!
  email: String!
  firstName: String!
  lastName: String!
  fullName: String!          # firstName + " " + lastName, computed
  baseRole: BaseRole!
  isPastor: Boolean!
  phone: String
  photoUrl: String
  birthDate: Date
  ministries: [MinistryMembership!]!   # solo activas (leftAt IS NULL)
  createdAt: DateTime!
}

type Ministry {
  id: ID!
  slug: String!
  name: String!
  description: String
  archivedAt: DateTime
  members(role: MinistryRole, includeLeft: Boolean = false): [MinistryMembership!]!
}

type MinistryMembership {
  id: ID!
  user: User!
  ministry: Ministry!
  role: MinistryRole!
  joinedAt: DateTime!
  leftAt: DateTime
}
```

### Queries

- `me: User` — usuario actual. **Dev-only hasta auth:** acepta un header `x-dev-user-id` para identificar quién está haciendo la request. En producción sin auth, devuelve `null`.
- `user(id: ID!): User`
- `users(filter: UserFilter, pagination: PaginationInput): UserConnection!`
  - `UserFilter`:
    - `baseRole`: `ASISTENTE` | `MIEMBRO`.
    - `isPastor`: bool.
    - `ministryId`: filtra por usuarios con **membership activo** (`leftAt IS NULL`) en ese ministerio.
    - `search`: match case-insensitive (`contains`) sobre `email`, `firstName`, `lastName`.
  - Paginación tipo cursor (Relay-style) — estándar y escala mejor que offset.
- `ministry(slug: String!): Ministry`
- `ministries(includeArchived: Boolean = false): [Ministry!]!`

### Mutations

- `createUser(input: CreateUserInput!): User!`
  - `CreateUserInput`: `email`, `firstName`, `lastName`, `phone?`, `birthDate?`.
  - Siempre crea con `baseRole: ASISTENTE`, `isPastor: false`. No acepta esos campos en el input.
- `updateUser(id: ID!, input: UpdateUserInput!): User!`
  - `UpdateUserInput`: campos básicos editables; excluye `baseRole` y `isPastor`.
- `softDeleteUser(id: ID!): User!`
- `setUserPastor(id: ID!, isPastor: Boolean!): User!` — solo invocable por otro pastor (documentado; enforce cuando haya auth).
- `createMinistry(input: CreateMinistryInput!): Ministry!`
- `updateMinistry(id: ID!, input: UpdateMinistryInput!): Ministry!`
- `archiveMinistry(id: ID!): Ministry!`
- `addUserToMinistry(userId: ID!, ministryId: ID!, role: MinistryRole!): MinistryMembership!`
  - Si existe un membership activo (`leftAt IS NULL`) del mismo par `(user, ministry)`, error.
- `removeUserFromMinistry(membershipId: ID!): MinistryMembership!` — setea `leftAt = now()`.

Todos los inputs se validan con Zod (schemas colocalizados con los resolvers).

## Migración

Una sola migración Prisma: `init_core_users_roles_ministries`. Incluye:
- Enums: `BaseRole`, `MinistryRole`.
- Tablas: `User`, `Ministry`, `MinistryMembership`.
- Índices y constraints descritos arriba.

No hay datos en este punto, así que no requiere backfill.

## Seed

`prisma/seed.ts`:
1. Si no existe ministerio con `slug: 'acogida'`, lo crea (`name: 'Acogida'`, descripción corta).
2. Idempotente: correrlo varias veces no duplica nada.

`scripts/create-pastor.ts`:
- CLI que acepta `--email`, `--firstName`, `--lastName`.
- Crea (o actualiza) el usuario con `baseRole: MIEMBRO`, `isPastor: true`.
- Documentado en README: "para crear el primer pastor, corre este script".

## Testing

**Unit**
- Validación Zod de inputs (`CreateUserInput`, `UpdateUserInput`, etc.).
- Middleware de soft delete: verifica que `findMany` filtra `deletedAt` y que `delete` lo convierte en update.
- Normalización de email a lowercase.

**E2E**
- Flujo: `createUser` → `addUserToMinistry` (ministerio seed `acogida`) → `users(filter: { ministryId })` retorna el user → `removeUserFromMinistry` → user ya no aparece en ese filtro pero sigue existiendo → `softDeleteUser` → ahora no aparece en `users()` sin filtro → `user(id)` retorna `null`.
- Verifica que `createMinistry` con slug duplicado falla.
- Verifica que `addUserToMinistry` duplicado (membership activo existente) falla.

## Criterio de "hecho"

1. `pnpm prisma:migrate` aplica la migración limpia sobre una DB vacía.
2. `pnpm prisma:seed` crea el ministerio `Acogida`.
3. `pnpm tsx scripts/create-pastor.ts --email ... --firstName ... --lastName ...` crea un pastor.
4. En Apollo Sandbox, el flujo E2E descrito arriba funciona manualmente.
5. `pnpm test` y `pnpm test:e2e` pasan.
6. `pnpm build` compila sin errores.

## Decisiones pospuestas (no para este spec)

- Autorización real (guards + auth). El spec documenta las reglas; la implementación es posterior.
- Auditoría detallada (quién creó a quién, cuándo cambió qué campo). Si se necesita, se añade con un modelo `AuditLog` en un spec dedicado.
- i18n de campos. Todo está en español directamente; si se internacionaliza, es otro spec.
- Búsqueda full-text sobre usuarios. Por ahora, `search` hace `contains` case-insensitive; si hay volumen, se migra a Postgres full-text o Meilisearch.
