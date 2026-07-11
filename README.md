# backend-alumbra

API backend para Alumbra. Stack: NestJS 10 + Prisma + PostgreSQL + GraphQL code-first.

## Prerrequisitos

- Node 20 (recomendado `nvm use 20`).
- pnpm 9 (`npm i -g pnpm`).
- PostgreSQL accesible. En dev lo habitual es:
  - `cloud-sql-proxy` exponiendo la DB remota en `localhost:5432`, o
  - Un Postgres local.

## Setup

```bash
pnpm install
cp .env.example .env
# Editar .env: como mínimo generar un JWT_SECRET (openssl rand -base64 48)
pnpm prisma:migrate      # aplica migraciones
pnpm prisma:seed         # crea datos iniciales (más adelante)
pnpm dev                 # arranca en http://localhost:4000
```

En dev, un Postgres local rápido con Docker:

```bash
docker run -d --name alumbra-postgres \
  -e POSTGRES_USER=alumbra -e POSTGRES_PASSWORD=password -e POSTGRES_DB=alumbra \
  -p 5432:5432 -v alumbra-pgdata:/var/lib/postgresql/data postgres:16
```

## Comprobar GraphQL

Abrir `http://localhost:4000/graphql` en el navegador para ver Apollo Sandbox, y ejecutar:

```graphql
{ apiVersion }
```

Debe devolver una cadena como `"0.0.1"`.

## Scripts

| Script | Descripción |
| --- | --- |
| `pnpm dev` | Arranca el servidor con watch mode. |
| `pnpm build` | Compila a `dist/`. |
| `pnpm start:prod` | Ejecuta el build de producción. |
| `pnpm test` | Unit tests (Jest). |
| `pnpm test:e2e` | Tests end-to-end (requiere DB accesible). |
| `pnpm lint` | ESLint + fix. |
| `pnpm format` | Prettier. |
| `pnpm prisma:migrate` | Crea/aplica migraciones en dev. |
| `pnpm prisma:generate` | Regenera el cliente Prisma. |
| `pnpm prisma:studio` | Abre Prisma Studio. |
| `pnpm prisma:seed` | Ejecuta el seed. |

## Cloud SQL Proxy (dev)

Cuando esté definida la infra en GCP, correr algo así:

```bash
cloud-sql-proxy --port 5432 <PROJECT:REGION:INSTANCE>
```

Y en `.env`:

```
DATABASE_URL=postgresql://<user>:<password>@localhost:5432/alumbra?schema=public
```

(El instance connection name se documentará cuando exista Pulumi.)

## Auth (credenciales)

Login con email/contraseña + access JWT (15 min) y refresh token rotatorio (30 días) persistido en DB. Google OAuth vendrá después sobre la misma base de tokens (`docs/superpowers/specs/2026-04-21-auth-design.md`).

Endpoints REST bajo `/auth`:

| Endpoint | Descripción |
| --- | --- |
| `POST /auth/login` | Body `{ "email", "password" }`. Devuelve `accessToken` + cookie HttpOnly `alumbra_rt` (refresh). |
| `POST /auth/refresh` | Lee la cookie, rota el refresh y devuelve un nuevo `accessToken`. |
| `POST /auth/logout` | Revoca la sesión y limpia la cookie. Idempotente. |

El access token viaja en `Authorization: Bearer <jwt>` en cada request GraphQL. Todos los resolvers requieren autenticación salvo `apiVersion`; las mutaciones privilegiadas requieren pastor o líder del ministerio objetivo (ver matriz en la spec de auth). Solo pueden entrar usuarios con `canSignIn: true` (un pastor lo habilita con la mutation `setUserSignInAllowed`); las contraseñas se asignan con `setUserPassword` (el propio usuario o un pastor).

Variables de entorno: `JWT_SECRET` (obligatoria, 32+ chars), `JWT_ACCESS_TTL` (default `15m`), `REFRESH_TTL_DAYS` (default `30`), `COOKIE_DOMAIN` (vacía en dev), `CORS_ORIGIN` (origen del front, default `http://localhost:3000`).

## Crear el primer pastor

Una vez aplicadas las migraciones:

```bash
pnpm tsx scripts/create-pastor.ts --email jane@example.com --firstName Jane --lastName Doe --password <min-8-chars>
```

Crea (o actualiza) el usuario como pastor con `canSignIn: true` y esa contraseña.

## Spec docs

- Scaffold: `docs/superpowers/specs/2026-04-21-backend-scaffold-design.md`
- Spec A (users/roles/ministries): `docs/superpowers/specs/2026-04-21-spec-a-users-roles-ministries-design.md`
- Auth (diseño Google OAuth + tokens; la parte de tokens/sesiones/guards ya está implementada con login por credenciales): `docs/superpowers/specs/2026-04-21-auth-design.md`
