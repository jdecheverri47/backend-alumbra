# Auth — Google OAuth + Access/Refresh tokens

**Fecha:** 2026-04-21
**Estado:** Aprobado
**Depende de:** `2026-04-21-spec-a-users-roles-ministries-design.md` (necesita `User`, `Ministry`, `MinistryMembership` ya implementados).

## Contexto

La API actualmente está 100% abierta: cualquiera que alcance el endpoint GraphQL puede crear usuarios, ascender pastores y archivar ministerios. Seis mutaciones privilegiadas llevan marca `// TODO(auth):` desde Spec A.

Este spec cierra ese hueco con:
- Login vía Google OAuth (ID token validado en el backend).
- JWT propio de Alumbra (access) + refresh token rotatorio persistido en DB.
- Guards de NestJS con rol base `@Authenticated`, `@RequirePastor`, `@RequireMinistryLeader`.
- Invitaciones por email transaccional (Resend) cuando un usuario gana permiso para entrar.

## Decisiones tomadas en brainstorming

- **Proveedor de identidad único: Google OAuth.** Implicit/ID token flow en el cliente — Next.js obtiene el ID token, lo manda al backend, el backend valida con las claves públicas de Google y emite su propio JWT.
- **Acceso controlado: no self-signup abierto.**
  - Miembros: su email ya existe en la DB (porque pasaron por el pipeline o porque fueron bulk-importados). Primer sign-in = activación automática.
  - Asistentes: su email existe en la DB (registrado por el ministerio de acogida) pero **`canSignIn: false` por defecto**. No pueden entrar hasta que se les convoque a la ruta de crecimiento (Spec B) o un pastor los habilite manualmente. Al flipear la bandera se envía un email informativo.
- **Tokens: access corto (15 min) + refresh largo (30 días) rotatorio.** Persistimos las sesiones en DB para poder revocarlas.
- **Email: Resend.** En dev, si `RESEND_API_KEY` empieza con `test`, el service hace `console.log` en vez de enviar.

## Cambios de schema

### `User`

Añadir el campo `canSignIn`:

```prisma
model User {
  // campos existentes…
  canSignIn Boolean @default(false)
}
```

Notas:
- La lógica "true por defecto para `MIEMBRO`, false para `ASISTENTE`" se enforzará en `UsersService.create`. El `@default(false)` a nivel DB es el caso seguro (asistentes); el service sobreescribe para miembros. Mantiene explícito el criterio sin meterlo en Prisma.
- Al promover un `ASISTENTE` a `MIEMBRO` (ocurre en Spec B tras aprobación), `canSignIn` debe quedar en `true`.

### Nueva tabla `Session`

```prisma
model Session {
  id               String    @id @default(cuid())
  userId           String
  user             User      @relation(fields: [userId], references: [id])
  refreshTokenHash String    @unique
  userAgent        String?
  ipAddress        String?
  createdAt        DateTime  @default(now())
  lastUsedAt       DateTime  @default(now())
  expiresAt        DateTime
  revokedAt        DateTime?

  @@index([userId])
  @@index([expiresAt])
}
```

- `refreshTokenHash` es un SHA-256 del refresh token opaco. Si hay brecha de DB, el atacante no puede usar los hashes.
- `revokedAt`: logout explícito o detección de reuse (ver más abajo).
- Limpieza: un cron job mensual (fuera de este spec) borra sesiones con `expiresAt < now() - 30 días`.

### Nueva tabla `Invitation`

```prisma
model Invitation {
  id         String    @id @default(cuid())
  userId     String    @unique
  user       User      @relation(fields: [userId], references: [id])
  sentAt     DateTime  @default(now())
  acceptedAt DateTime?
}
```

- Una invitación por usuario (único por `userId`). Si hay que reenviar, se regenera `sentAt`.
- `acceptedAt` se setea en el primer login exitoso. Útil para métricas ("cuántos asistentes convocados nunca entraron").

### Migración

Una sola migración Prisma: `auth_sessions_and_invitations`. Añade el campo `canSignIn` (con backfill) y crea las dos tablas nuevas.

**Backfill**: para los usuarios ya existentes al momento de aplicar la migración:
- `isPastor: true` → `canSignIn: true`.
- `baseRole: MIEMBRO` → `canSignIn: true`.
- Resto (`ASISTENTE` no pastores) → `canSignIn: false`.

Esto se hace dentro del SQL de la migración (`UPDATE "User" SET "canSignIn" = true WHERE "isPastor" = true OR "baseRole" = 'MIEMBRO'`) después del `ALTER TABLE`.

## Endpoints

Los endpoints de auth son REST (no GraphQL) para simplificar el manejo de cookies y status codes HTTP estándar. Viven en un `AuthController` bajo el prefijo `/auth`.

### `POST /auth/google`

Login con Google ID token.

**Request**:
```json
{ "idToken": "<eyJhbGc...>" }
```

**Flujo**:
1. Validar `idToken` con `google-auth-library` contra `GOOGLE_CLIENT_ID`.
2. Verificar `payload.email_verified === true`. Si no: `403 EMAIL_NOT_VERIFIED`.
3. Buscar `User`:
   - Primero por `googleId === payload.sub` (identificador estable de Google).
   - Si no hay, por `email === payload.email.toLowerCase()`.
4. Si no existe: `403 USER_NOT_REGISTERED` con mensaje `"Tu email no está registrado. Habla con tu líder de acogida."`.
5. Si `user.deletedAt !== null`: `403 USER_DELETED`.
6. Si `user.canSignIn === false`: `403 ACCESS_NOT_GRANTED` con mensaje `"Aún no tienes acceso a la app. Espera a que te convoquen a la ruta de crecimiento."`.
7. Si `user.googleId === null`, guardarlo ahora (vinculación).
8. Si existe `Invitation` del user con `acceptedAt === null`, setear `acceptedAt: now()`.
9. Generar refresh token opaco (32 bytes random → base64url), calcular SHA-256, crear `Session` con `expiresAt = now() + 30d`, `userAgent` y `ipAddress` tomados del request.
10. Emitir access JWT.

**Response 200**:
```json
{
  "accessToken": "<jwt>",
  "accessTokenExpiresAt": "2026-04-21T12:45:00Z",
  "user": { "id": "...", "email": "...", "firstName": "...", "lastName": "...", "baseRole": "MIEMBRO", "isPastor": false }
}
```

**Cookie Set**:
```
Set-Cookie: alumbra_rt=<refresh-opaco>; HttpOnly; Secure; SameSite=Lax; Path=/auth; Max-Age=2592000
```

### `POST /auth/refresh`

Intercambiar refresh por nuevo access.

**Request**: vacío. Lee cookie `alumbra_rt`.

**Flujo**:
1. Leer cookie. Si falta: `401 NO_REFRESH_TOKEN`.
2. Calcular `hash = sha256(cookie)`.
3. Buscar `Session` por `refreshTokenHash = hash`.
4. Validar: `revokedAt === null`, `expiresAt > now()`, `user.deletedAt === null`, `user.canSignIn === true`.
5. Si cualquier validación falla:
   - Si `revokedAt !== null` (reuse detectado) → revocar TODAS las sesiones del usuario (`UPDATE "Session" SET "revokedAt" = now() WHERE "userId" = ?`). Esto protege contra un refresh filtrado que reapareció después de rotación.
   - Limpiar cookie. `401`.
6. **Rotación**: generar nuevo refresh token opaco, hashearlo, actualizar la `Session` existente con el nuevo hash, `lastUsedAt: now()`, `expiresAt: now() + 30d`. El refresh anterior queda inválido.
7. Emitir nuevo access JWT.

**Response 200**:
```json
{ "accessToken": "<jwt>", "accessTokenExpiresAt": "..." }
```

**Cookie Set**: actualiza `alumbra_rt` con el nuevo refresh.

### `POST /auth/logout`

Invalida la sesión actual.

**Flujo**:
1. Leer cookie.
2. Si existe, buscar `Session` y setear `revokedAt: now()`.
3. Limpiar cookie (`Set-Cookie: alumbra_rt=; Max-Age=0`).
4. `200 { ok: true }` siempre (idempotente; logout sin sesión también retorna 200).

## Access JWT

- **Algoritmo**: HS256. `JWT_SECRET` en env, mínimo 32 bytes random.
- **TTL**: 15 minutos (`JWT_ACCESS_TTL`, configurable).
- **Payload**:
  ```json
  {
    "sub": "<userId>",
    "email": "<email>",
    "isPastor": true,
    "baseRole": "MIEMBRO",
    "iat": 1714054800,
    "exp": 1714055700
  }
  ```
- **Transmisión**: `Authorization: Bearer <jwt>` en cada request GraphQL.

## Refresh token

- **Formato**: string opaco de 32 bytes random codificado en base64url (~43 caracteres).
- **Almacenamiento en DB**: solo el SHA-256 hash (`crypto.createHash('sha256').update(token).digest('hex')`). Nunca se guarda el valor plano.
- **TTL**: 30 días, se extiende con cada uso (rotación).
- **Cookie**: `HttpOnly; Secure; SameSite=Lax; Path=/auth`. El `Path=/auth` significa que la cookie solo se manda a los endpoints de auth, no con cada request GraphQL — reduce la superficie de ataque.

## Guards y decorators

### `JwtAuthGuard` (global)

Registrado como `APP_GUARD` en el `AuthModule`. Aplica a todos los resolvers GraphQL por defecto.

Flujo:
1. Extrae `Authorization: Bearer <token>` del request HTTP.
2. Si falta o es inválido: `UnauthorizedException` (GraphQL lo convierte en `UNAUTHENTICATED`).
3. Verifica firma y exp del JWT.
4. Carga `User` de DB por `sub` (no confía solo en el JWT por si cambió `isPastor` o `canSignIn`).
5. Si `user.deletedAt !== null` o `user.canSignIn === false`: `UnauthorizedException`.
6. Adjunta al request: `request.user = { sub, email, isPastor, baseRole, user: <full User row> }`.

### `@Public()` decorator

Metadata que excepta del `JwtAuthGuard`. Solo para `POST /auth/google`, `POST /auth/refresh`, `POST /auth/logout`. Implementación estándar vía `SetMetadata('isPublic', true)` leída por el guard.

### `@CurrentUser()` parameter decorator

Extrae `request.user` para inyectarlo como argumento en resolvers:

```ts
@Query(() => UserModel)
me(@CurrentUser() me: AuthenticatedUser) { ... }
```

Tipo `AuthenticatedUser`:
```ts
interface AuthenticatedUser {
  sub: string;       // userId
  email: string;
  isPastor: boolean;
  baseRole: BaseRole;
  user: User;        // full row, útil para evitar refetch
}
```

### `@RequirePastor()` decorator + `PastorGuard`

Decorator: `SetMetadata('requirePastor', true)`.
Guard: lee la metadata; si `true`, verifica `request.user.isPastor === true`; si no, `ForbiddenException` (`FORBIDDEN`).

Uso:
```ts
@RequirePastor()
@Mutation(() => MinistryModel)
async createMinistry(...) { ... }
```

### `@RequireMinistryLeader(arg)` decorator + `MinistryLeaderGuard`

Decorator recibe el nombre del argumento GraphQL que contiene el `ministryId` (o una función que lo deriva de los args).

Guard:
1. Si `request.user.isPastor === true` → pasa.
2. Lee el `ministryId` del argumento.
3. Busca `MinistryMembership` con `userId: request.user.sub`, `ministryId`, `role: LEADER`, `leftAt: null`.
4. Si existe → pasa. Si no → `ForbiddenException`.

Para casos como `removeUserFromMinistry` que reciben `membershipId` en vez de `ministryId`, el decorator acepta una función resolver: `@RequireMinistryLeader(args => resolveMinistryIdFromMembership(args.membershipId))`. El guard se encarga del lookup async.

### `UserOwnershipGuard` (para `updateUser`)

Permite: user se actualiza a sí mismo, O es pastor. Lógica:

```ts
@Mutation(() => UserModel)
@UseGuards(UserOwnershipGuard)  // o decorator @SelfOrPastor()
async updateUser(
  @Args('id', { type: () => ID }) id: string,
  @Args('input') input: UpdateUserInput,
  @CurrentUser() me: AuthenticatedUser,
) {
  if (me.sub !== id && !me.isPastor) throw new ForbiddenException();
  return this.usersService.updateById(id, input);
}
```

(Se puede implementar como guard o como check inline en el resolver — inline es más honesto para esta lógica de dos casos. Dejar el equipo decidir al implementar; el spec sólo fija el comportamiento.)

## Matriz de autorización

| Operación | Guard / Regla |
|---|---|
| `POST /auth/google` | Público |
| `POST /auth/refresh` | Público (valida cookie) |
| `POST /auth/logout` | Público (idempotente) |
| `me` (query) | Autenticado |
| `user(id)` (query) | Autenticado |
| `users(filter, pagination)` (query) | Autenticado |
| `ministry(slug)` (query) | Autenticado |
| `ministries` (query) | Autenticado |
| `Ministry.members` (resolveField) | Autenticado |
| `User.ministries` (resolveField) | Autenticado |
| `createUser` (mutation) | Pastor **O** líder del ministerio de acogida. Nota: `createUser` actualmente no toma `ministryId`. La regla se enforca así: solo pastores y líderes de acogida pueden llamarla; el check es en el resolver (lee slug `acogida`, verifica membership leader del user actual). |
| `updateUser` (mutation) | Self o pastor. |
| `softDeleteUser` (mutation) | Pastor. |
| `setUserPastor` (mutation) | Pastor. |
| `setUserSignInAllowed(id, allowed)` (mutation NUEVA) | Pastor. |
| `resendInvitation(userId)` (mutation NUEVA) | Pastor. |
| `createMinistry` (mutation) | Pastor. |
| `updateMinistry` (mutation) | Pastor. |
| `archiveMinistry` (mutation) | Pastor. |
| `addUserToMinistry` (mutation) | Líder del ministerio objetivo (o pastor). |
| `removeUserFromMinistry` (mutation) | Líder del ministerio objetivo (o pastor). Resuelve ministryId desde membershipId. |

Las seis mutaciones con `// TODO(auth):` de Spec A quedan cubiertas. Los TODOs se eliminan al aplicar los guards.

## `me` query

```graphql
type Query {
  me: User!
}
```

```ts
@Query(() => UserModel)
async me(@CurrentUser() me: AuthenticatedUser): Promise<UserModel> {
  // Refetch para reflejar cambios recientes (isPastor, canSignIn, etc.).
  const user = await this.usersService.findByIdOrThrow(me.sub);
  return toUserModel(user);
}
```

Retorna non-null porque si el JWT no es válido, el guard ya abortó antes.

## Invitaciones

### Trigger

Cuando `canSignIn` transita `false → true`:
- En `UsersService.setSignInAllowed(id, true)`: después del update, si el valor previo era `false`, invoca `InvitationService.sendInvitation(userId)`.
- En los servicios de Spec B que convoquen a la ruta (a definirse en ese spec): igual patrón.

### `InvitationService.sendInvitation(userId)`

1. Busca el user. Si no existe o `canSignIn` es `false`: no-op (con log).
2. Upsert en tabla `Invitation` por `userId` único:
   - Si no existe → crea con `sentAt: now()`.
   - Si existe y `acceptedAt === null` → actualiza `sentAt: now()`.
   - Si existe y `acceptedAt !== null` → no-op (ya aceptó; si necesitas reenvío, usa `resendInvitation` que fuerza).
3. Llama a Resend con el template.

### Template del email

Subject: `Bienvenid@ a Alumbra, {{firstName}}`

Body (HTML inline simple; extracción a template externo si crece):

```html
<p>Hola {{firstName}},</p>
<p>Ya tienes acceso a Alumbra. Puedes iniciar sesión con tu cuenta de Google usando este email:</p>
<p><strong>{{email}}</strong></p>
<p><a href="{{appUrl}}/login" style="...">Iniciar sesión</a></p>
<p>Si tienes dudas, escríbele a tu líder.</p>
<p>— El equipo de Alumbra</p>
```

### Reenvío manual

`resendInvitation(userId)` — solo pastores. Siempre dispara un envío (ignora el `acceptedAt` previo, por si el usuario borró el email sin querer).

### Dev: modo test

Si `process.env.NODE_ENV !== 'production'` y `process.env.RESEND_API_KEY?.startsWith('test')`, `InvitationService` loguea a consola en vez de llamar a Resend:

```
[InvitationService][test mode] Would send invitation to ana@x.com (userId: clx...) subject: "Bienvenid@ a Alumbra, Ana"
```

## Errores y edge cases

| Código | HTTP | Cuándo |
|---|---|---|
| `EMAIL_NOT_VERIFIED` | 403 | `email_verified !== true` en ID token de Google |
| `USER_NOT_REGISTERED` | 403 | Email no existe en DB |
| `USER_DELETED` | 403 | `user.deletedAt !== null` |
| `ACCESS_NOT_GRANTED` | 403 | `user.canSignIn === false` |
| `INVALID_GOOGLE_TOKEN` | 401 | ID token inválido, expirado, o firmado incorrectamente |
| `NO_REFRESH_TOKEN` | 401 | No hay cookie `alumbra_rt` en `/auth/refresh` |
| `INVALID_REFRESH_TOKEN` | 401 | Refresh no existe, expiró, o fue revocado |
| `UNAUTHENTICATED` | 401 | JWT faltante o inválido en cualquier endpoint no-público (GraphQL retorna `errors: [{ extensions: { code: "UNAUTHENTICATED" }}]`) |
| `FORBIDDEN` | 403 | Guard de pastor/líder rechaza |

Todos los códigos viajan en el body:
```json
{ "error": "USER_NOT_REGISTERED", "message": "Tu email no está registrado. Habla con tu líder de acogida." }
```

## Rate limiting

`@nestjs/throttler` aplicado a los endpoints de auth:
- `POST /auth/google`: 5 requests / 15 min por IP.
- `POST /auth/refresh`: 30 / 15 min por IP (más laxo; los clientes legítimos refrescan seguido).
- `POST /auth/logout`: sin rate limit (acción benigna).

Esto previene enumeración de emails y brute-force de refresh tokens.

## Testing

### Unit

- `GoogleTokenVerifier` (wrapper de `google-auth-library`): mockea la lib, prueba payload válido / expirado / email no verificado / client id incorrecto.
- `JwtService` helpers: emite y verifica; rechaza firmas inválidas y tokens expirados.
- `InvitationService`: mockea Resend; verifica que en test mode loguea; verifica no-op para usuarios ya con `acceptedAt`.
- Guards: `PastorGuard`, `MinistryLeaderGuard`, con mocks de `ExecutionContext`.

### Integration (DB real)

- `AuthService.loginWithGoogle`:
  - User no existe → 403.
  - User existe pero `canSignIn: false` → 403.
  - User existe + `canSignIn: true` + no `googleId` → emite tokens, guarda googleId, setea `acceptedAt` en invitación.
  - User existe + `canSignIn: true` + `googleId` match → emite tokens.
- `AuthService.refresh`:
  - Refresh válido → rota, emite nuevo access.
  - Refresh revocado → 401 + revoca todas las sesiones del user (detección de reuse).
  - Refresh expirado → 401.
- `AuthService.logout`: revoca la session activa.

### E2E

- **Flujo feliz**: mock Google ID token → `POST /auth/google` → recibe access + cookie → `POST /graphql { me }` con access → retorna user → `POST /auth/refresh` con cookie → nuevo access → `POST /auth/logout` → cookie limpiada → `POST /auth/refresh` retorna 401.
- **Autorización por rol**:
  - User no-pastor intenta `createMinistry` → 403 (sin afectar DB).
  - User pastor logra `createMinistry` → 200.
  - Líder de acogida logra `createUser` → 200.
  - Miembro no-líder intenta `createUser` → 403.
- **Invitación**: flipear `canSignIn` vía `setUserSignInAllowed` con pastor → verificar que `InvitationService.sendInvitation` fue llamado (test mode → log capturado).

### Test helper: mock Google ID token

Los tests no hablan con Google real. Crear un helper que genera un "fake ID token" (un JWT firmado con una clave de prueba), y en test mode el `GoogleTokenVerifier` acepta esa clave. Controlado por `GOOGLE_TEST_MODE_PUBLIC_KEY` env var en `NODE_ENV=test`.

## Variables de entorno nuevas

```
# Google OAuth
GOOGLE_CLIENT_ID=<id del proyecto de Google>

# JWT
JWT_SECRET=<random 32+ bytes base64>
JWT_ACCESS_TTL=15m
REFRESH_TTL_DAYS=30

# Email (Resend)
RESEND_API_KEY=<re_...>          # en dev: test_local (hace no-op)
RESEND_FROM_EMAIL=no-reply@alumbra.church
APP_URL=http://localhost:3000    # en prod: https://app.alumbra.com

# Cookies
COOKIE_DOMAIN=                   # vacío en dev (localhost); en prod .alumbra.church
```

Actualizar `env.schema.ts` (Zod) para validar todos los nuevos campos.

## Fuera de alcance

- Auditoría detallada de eventos de auth (login, logout, failed attempts). Agregar `AuditLog` en un spec futuro si surge la necesidad.
- Multi-factor auth (TOTP, SMS).
- "Cerrar sesión en todos los dispositivos" (base técnica existe: revocar todas las `Session` del user; se expone cuando haga falta).
- Password fallback.
- Migración de cuenta Google a otra (cambio de `googleId`). Manual en DB por ahora.
- Sign-in silencioso / persistencia entre reloads cuando el access expira (el frontend lo maneja con refresh automático).
- Protección CSRF adicional. Dado que el refresh usa `SameSite=Lax` y el access va por `Authorization` header (no cookie), el riesgo CSRF es bajo. Se puede añadir `Origin` check en `/auth/refresh` si se considera necesario, pero queda fuera de la v1.

## Criterio de "hecho"

1. Migración aplicada: `canSignIn`, `Session`, `Invitation`.
2. `AuthController` con los tres endpoints funcionando; `POST /auth/google` con un ID token real de Google emite access + cookie.
3. `me` query retorna el user autenticado.
4. Todos los guards aplicados a las operaciones de la matriz; los seis `// TODO(auth):` de Spec A eliminados.
5. Al convocar un asistente vía `setUserSignInAllowed(id, true)` (ejecutado por un pastor), se dispara invitación a Resend (o log en test mode).
6. `pnpm test` + `pnpm test:e2e` verdes. Nuevos tests cubren: flujo happy path, fallo por `canSignIn: false`, fallo por rol insuficiente, refresh rotation, detección de reuse, logout.
7. `pnpm build` y `pnpm lint` limpios.
8. README actualizado con: variables de entorno nuevas, instrucciones para obtener un Google Client ID en desarrollo, cómo mockear Google en tests locales.
