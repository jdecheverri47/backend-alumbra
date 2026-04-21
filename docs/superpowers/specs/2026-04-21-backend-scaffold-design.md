# Backend Alumbra — Scaffold inicial

**Fecha:** 2026-04-21
**Estado:** Aprobado

## Contexto

`backend-alumbra` está vacío (solo `.git`). Es el backend API de Alumbra. El frontend vive en un repo hermano (`frontend-alumbra`, Next.js) y se mantendrá separado. La infraestructura se gestionará con Pulumi sobre GCP en una sesión posterior (`infra/` queda para después). En dev local, la API se conectará a una base de datos Cloud SQL remota vía `cloud-sql-proxy`.

## Objetivo

Dejar el scaffold de una API Nest lista para que empiecen a modelarse features reales: config validada, Prisma conectando a Postgres, GraphQL code-first sirviendo un resolver de salud end-to-end, y scripts de desarrollo.

## No-objetivos

- Autenticación (se diseña e implementa en otra sesión).
- Scaffolding de Pulumi / carpeta `infra/`.
- Dockerfile de producción (depende de la decisión Cloud Run vs GKE).
- CI/CD.
- Docker Compose para Postgres local (no se usa: dev va a Cloud SQL remoto).
- Monorepo (NestJS monorepo o pnpm workspaces). Si en el futuro se necesita, migrar es directo.

## Stack

- **Node 20 LTS**
- **pnpm** como package manager
- **TypeScript** con `strict: true`
- **NestJS 10** (app única)
- **Prisma** (cliente + migraciones) + **PostgreSQL**
- **GraphQL code-first** con `@nestjs/graphql` + `@nestjs/apollo` (Apollo Server v4)
- **`@nestjs/config`** + **Zod** para validación de variables de entorno
- **Jest** + **supertest** (defaults de Nest)
- **ESLint + Prettier** (defaults de Nest)

## Estructura de carpetas

```
backend-alumbra/
├── src/
│   ├── main.ts                    # bootstrap, escucha en process.env.PORT
│   ├── app.module.ts              # ConfigModule, GraphQLModule, PrismaModule, HealthModule
│   ├── config/
│   │   ├── env.schema.ts          # Zod schema de variables de entorno
│   │   └── config.module.ts       # wrapper sobre @nestjs/config con validate
│   ├── prisma/
│   │   ├── prisma.module.ts       # @Global(), exporta PrismaService
│   │   └── prisma.service.ts      # extiende PrismaClient, OnModuleInit → $connect
│   ├── graphql/
│   │   └── schema.gql             # autogenerado por code-first; se commitea (ver sección GraphQL)
│   ├── health/
│   │   ├── health.module.ts
│   │   └── health.resolver.ts     # query ping: String → "pong"; chequea DB con SELECT 1
│   └── modules/                   # carpeta vacía, placeholder para features
├── prisma/
│   └── schema.prisma              # datasource postgres, generator client, modelo Health mínimo
├── test/
│   ├── app.e2e-spec.ts            # ping query vía supertest
│   └── jest-e2e.json
├── .env.example
├── .gitignore
├── .eslintrc.js
├── .prettierrc
├── nest-cli.json
├── package.json
├── tsconfig.json
├── tsconfig.build.json
└── README.md
```

**Decisión:** `src/graphql/schema.gql` se commitea al repo para que sea fácil diffearlo en PRs. Se regenera en cada arranque (`autoSchemaFile`), así que si alguien olvida commitearlo el CI lo detecta con un `git diff --exit-code` cuando se añada CI.

## Variables de entorno

`.env.example`:

```
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://alumbra:password@localhost:5432/alumbra?schema=public
```

`src/config/env.schema.ts` define un Zod schema que valida al arrancar. Si falta o está mal una variable, el proceso termina con un mensaje claro (lista de errores de Zod). La función de validación se pasa a `ConfigModule.forRoot({ validate })`.

Variables:
- `NODE_ENV`: `development` | `production` | `test`
- `PORT`: número, default `3000`
- `DATABASE_URL`: string no vacío, debe parsear como URL

## GraphQL

- Driver: `ApolloDriver` (Apollo Server 4) vía `@nestjs/apollo`.
- `autoSchemaFile: join(process.cwd(), 'src/graphql/schema.gql')`.
- `sortSchema: true` para que el SDL sea estable y los diffs limpios.
- `playground: false`, `introspection: true`, Apollo Sandbox se sirve automáticamente cuando `NODE_ENV !== 'production'`.
- Resolver de verificación: `HealthResolver` con `@Query(() => String) ping()` que ejecuta `await this.prisma.$queryRaw\`SELECT 1\`` y retorna `'pong'`. Si falla, propaga el error (Nest lo convierte en error GraphQL).

## Prisma

`prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Health {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
}
```

El modelo `Health` existe solo para validar que las migraciones corren contra Cloud SQL. Se puede eliminar cuando llegue el primer modelo real.

`PrismaService`:

```ts
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect();
  }
}
```

`PrismaModule` está marcado `@Global()`, así cualquier módulo inyecta `PrismaService` sin reimportar.

## Scripts (`package.json`)

- `dev` — `nest start --watch`
- `build` — `nest build`
- `start` — `node dist/main`
- `start:prod` — `node dist/main` con `NODE_ENV=production`
- `test` — `jest`
- `test:watch` — `jest --watch`
- `test:cov` — `jest --coverage`
- `test:e2e` — `jest --config ./test/jest-e2e.json`
- `lint` — `eslint "{src,test}/**/*.ts" --fix`
- `format` — `prettier --write "src/**/*.ts" "test/**/*.ts"`
- `prisma:generate` — `prisma generate`
- `prisma:migrate` — `prisma migrate dev`
- `prisma:deploy` — `prisma migrate deploy` (para producción)
- `prisma:studio` — `prisma studio`
- `prisma:seed` — `ts-node prisma/seed.ts` (el seed es un stub vacío por ahora)

## Testing

- **Unit:** `health.resolver.spec.ts` mockea `PrismaService.$queryRaw` y verifica que `ping()` retorna `'pong'`.
- **E2E:** `app.e2e-spec.ts` levanta la app con Nest Testing, hace un POST a `/graphql` con la query `{ ping }` usando supertest, y espera `data.ping === 'pong'`. Requiere DB accesible; documentado en README que los e2e necesitan el proxy corriendo o se skipean con `SKIP_E2E=1`.

## README

Secciones:
1. **Prerrequisitos**: Node 20, pnpm, `gcloud` CLI con `cloud-sql-proxy` instalado.
2. **Setup inicial**:
   - `pnpm install`
   - Copiar `.env.example` → `.env` y ajustar.
   - Levantar `cloud-sql-proxy` (placeholder para el instance connection name — se llena cuando exista Pulumi).
   - `pnpm prisma:migrate` (crea las tablas).
   - `pnpm dev` (arranca la API).
3. **Probar GraphQL**: abrir `http://localhost:3000/graphql` en el browser, ejecutar `{ ping }` en Apollo Sandbox.
4. **Scripts útiles** (referencia rápida de los de `package.json`).
5. **Estructura** (link a este spec).

## Flujo de verificación end-to-end

Tras el scaffold, el dev debería poder:
1. `pnpm install`
2. Configurar `.env` con un `DATABASE_URL` que apunte a una DB Postgres accesible (local, proxy, o remota).
3. `pnpm prisma:migrate` → crea la tabla `Health`.
4. `pnpm dev` → arranca sin errores, logs de Nest muestran Apollo listo.
5. En Apollo Sandbox, ejecutar `{ ping }` → recibe `"pong"`.
6. `pnpm test` → pasa el unit test.
7. `pnpm build` → compila a `dist/` sin errores de tipos.

Si cualquiera de estos pasos falla, el scaffold está incompleto.

## Decisiones pospuestas

- **Logger estructurado (pino) vs logger default de Nest**: por ahora el default. Cuando haya tráfico real, migrar a `nestjs-pino`.
- **Terminus para health check HTTP** (`/health`): no se incluye ahora. GraphQL `ping` es suficiente para validar liveness. Se añade cuando haya un balanceador que lo requiera.
- **CORS / Helmet / rate limiting**: no en este scaffold. Se configuran cuando haya un frontend consumiendo la API.
- **Seed real**: el script existe como stub; se llena cuando haya modelos de dominio.
