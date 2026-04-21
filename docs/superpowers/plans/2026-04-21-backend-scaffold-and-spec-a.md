# Backend Scaffold + Spec A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the NestJS + Prisma + GraphQL backend (Phase 1), then implement the core users/roles/ministries domain (Phase 2), culminating in a working GraphQL API with seed data and end-to-end tests.

**Architecture:** Single-app NestJS 10 project (not a monorepo), TypeScript strict, PostgreSQL via Prisma, GraphQL code-first with Apollo driver. Soft-deleted users, cursor-paginated listings, seeded `Acogida` ministry. Auth is out of scope.

**Tech Stack:** Node 20, pnpm, TypeScript 5, NestJS 10, Prisma 5, PostgreSQL, `@nestjs/graphql` + `@nestjs/apollo` (Apollo Server 4), Zod, Jest, supertest.

**Specs:**
- `docs/superpowers/specs/2026-04-21-backend-scaffold-design.md`
- `docs/superpowers/specs/2026-04-21-spec-a-users-roles-ministries-design.md`

---

## Preconditions

Before starting:
- Working directory is `/Users/joseecheverri/dev/alumbra/backend-alumbra`.
- Node 20.x and pnpm installed globally (`node -v`, `pnpm -v`).
- A PostgreSQL database reachable at `DATABASE_URL` (local Postgres or `cloud-sql-proxy` forwarding Cloud SQL to `localhost:5432`). For development and E2E tests you need an actual DB — the plan assumes one is available.
- Git is clean (`git status` shows only the already-committed specs).

**IMPORTANT — test database:** unit tests in Phase 2 (Tasks 2.2, 2.5, 2.8) and the E2E suite (Task 2.12) **wipe the `User`, `Ministry`, and `MinistryMembership` tables** with raw `DELETE` statements to isolate each run. They run against the DB pointed to by `DATABASE_URL`. Use a dedicated dev/test database — never run these tests against a DB that contains real church data.

If no Postgres is reachable when starting Phase 2 Task 2.1, pause and tell the user: "Necesito una DB Postgres accesible para aplicar la migración. ¿Puedo asumir una local en `localhost:5432/alumbra` con user `alumbra`?"

---

# Phase 1 — Backend Scaffold

After Phase 1 the repo boots: `pnpm dev` starts the server, Apollo Sandbox loads at `http://localhost:3000/graphql`, `{ ping }` returns `"pong"`, `pnpm test:e2e` passes, `pnpm build` compiles.

---

## Task 1.1: Initialize pnpm project and base config files

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.prettierrc`
- Create: `.eslintrc.js`
- Create: `tsconfig.json`
- Create: `tsconfig.build.json`
- Create: `nest-cli.json`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "backend-alumbra",
  "version": "0.0.1",
  "description": "Alumbra backend API",
  "private": true,
  "packageManager": "pnpm@9.0.0",
  "engines": {
    "node": ">=20.0.0"
  },
  "scripts": {
    "build": "nest build",
    "format": "prettier --write \"src/**/*.ts\" \"test/**/*.ts\"",
    "start": "nest start",
    "dev": "nest start --watch",
    "start:debug": "nest start --debug --watch",
    "start:prod": "node dist/main",
    "lint": "eslint \"{src,test,scripts}/**/*.ts\" --fix",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:cov": "jest --coverage",
    "test:e2e": "jest --config ./test/jest-e2e.json",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:deploy": "prisma migrate deploy",
    "prisma:studio": "prisma studio",
    "prisma:seed": "tsx prisma/seed.ts"
  },
  "prisma": {
    "seed": "tsx prisma/seed.ts"
  }
}
```

- [ ] **Step 2: Create `.gitignore`**

```gitignore
# deps
node_modules/

# build
dist/

# env
.env
.env.local
.env.*.local
!.env.example

# logs
*.log

# editor
.vscode/
.idea/
.DS_Store

# tests
coverage/

# prisma
prisma/*.db

# Note: src/graphql/schema.gql IS committed (see scaffold spec)
```

- [ ] **Step 3: Create `.prettierrc`**

```json
{
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "semi": true
}
```

- [ ] **Step 4: Create `.eslintrc.js`**

```js
module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint/eslint-plugin'],
  extends: [
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
  ],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: ['.eslintrc.js', 'dist', 'node_modules'],
  rules: {
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'warn',
  },
};
```

- [ ] **Step 5: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "declaration": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "target": "ES2022",
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": true,
    "skipLibCheck": true,
    "strict": true,
    "strictNullChecks": true,
    "noImplicitAny": true,
    "strictBindCallApply": true,
    "forceConsistentCasingInFileNames": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 6: Create `tsconfig.build.json`**

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "test", "dist", "**/*spec.ts", "scripts", "prisma"]
}
```

- [ ] **Step 7: Create `nest-cli.json`**

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true
  }
}
```

- [ ] **Step 8: Verify `ls` shows all seven files at the repo root**

Run: `ls -la`
Expected: entries for `.eslintrc.js`, `.gitignore`, `.prettierrc`, `nest-cli.json`, `package.json`, `tsconfig.build.json`, `tsconfig.json` (plus `.git`, `docs/`).

- [ ] **Step 9: Commit**

```bash
git add .gitignore .prettierrc .eslintrc.js tsconfig.json tsconfig.build.json nest-cli.json package.json
git commit -m "chore: initial pnpm + typescript + nest-cli config"
```

---

## Task 1.2: Install dependencies

**Files:**
- Modify: `package.json` (populated by pnpm install)
- Create: `pnpm-lock.yaml`

- [ ] **Step 1: Install runtime dependencies**

Run:
```bash
pnpm add @nestjs/common@^10 @nestjs/core@^10 @nestjs/platform-express@^10 \
  @nestjs/config@^3 @nestjs/graphql@^12 @nestjs/apollo@^12 \
  @apollo/server@^4 graphql@^16 graphql-tag@^2 \
  @prisma/client@^5 \
  reflect-metadata@^0.2 rxjs@^7 \
  zod@^3
```

Expected: pnpm installs, creates `node_modules/`, creates/updates `pnpm-lock.yaml`. No errors.

- [ ] **Step 2: Install dev dependencies**

Run:
```bash
pnpm add -D @nestjs/cli@^10 @nestjs/schematics@^10 @nestjs/testing@^10 \
  @types/express @types/jest @types/node@^20 @types/supertest \
  @typescript-eslint/eslint-plugin@^7 @typescript-eslint/parser@^7 \
  eslint@^8 eslint-config-prettier eslint-plugin-prettier \
  prettier@^3 prisma@^5 \
  jest@^29 ts-jest@^29 ts-loader@^9 tsx@^4 typescript@^5 supertest@^6 \
  source-map-support@^0.5
```

Expected: dev deps installed, `pnpm-lock.yaml` updated.

- [ ] **Step 3: Verify no peer dependency conflicts**

Run: `pnpm install`
Expected: "Lockfile is up to date, resolution step is skipped" or "Already up to date". No ERR_PNPM errors.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: install nestjs, prisma, graphql, and tooling"
```

---

## Task 1.3: Bootstrap a minimal Nest app

**Files:**
- Create: `src/main.ts`
- Create: `src/app.module.ts`

- [ ] **Step 1: Create `src/app.module.ts`**

```ts
import { Module } from '@nestjs/common';

@Module({
  imports: [],
  controllers: [],
  providers: [],
})
export class AppModule {}
```

- [ ] **Step 2: Create `src/main.ts`**

```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(`Alumbra backend listening on http://localhost:${port}`, 'Bootstrap');
}

bootstrap();
```

- [ ] **Step 3: Verify it compiles**

Run: `pnpm build`
Expected: `dist/` created, no TypeScript errors.

- [ ] **Step 4: Verify it boots**

Run: `pnpm start` (press Ctrl+C after seeing the log line).
Expected: Log line `Alumbra backend listening on http://localhost:3000`.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts src/app.module.ts
git commit -m "feat: bootstrap minimal nest app"
```

---

## Task 1.4: Configuration module with Zod validation

**Files:**
- Create: `src/config/env.schema.ts`
- Create: `src/config/config.module.ts`
- Create: `.env.example`
- Modify: `src/app.module.ts` (import ConfigModule)
- Test: `src/config/env.schema.spec.ts`

- [ ] **Step 1: Write the failing test `src/config/env.schema.spec.ts`**

```ts
import { validateEnv } from './env.schema';

describe('validateEnv', () => {
  it('parses a valid environment', () => {
    const result = validateEnv({
      NODE_ENV: 'development',
      PORT: '3000',
      DATABASE_URL: 'postgresql://u:p@localhost:5432/alumbra',
    });
    expect(result.NODE_ENV).toBe('development');
    expect(result.PORT).toBe(3000);
    expect(result.DATABASE_URL).toBe('postgresql://u:p@localhost:5432/alumbra');
  });

  it('defaults PORT to 3000 when missing', () => {
    const result = validateEnv({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://u:p@localhost:5432/alumbra',
    });
    expect(result.PORT).toBe(3000);
  });

  it('throws when DATABASE_URL is missing', () => {
    expect(() =>
      validateEnv({ NODE_ENV: 'development' }),
    ).toThrow(/DATABASE_URL/);
  });

  it('throws when DATABASE_URL is not a URL', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'development',
        DATABASE_URL: 'not-a-url',
      }),
    ).toThrow(/DATABASE_URL/);
  });

  it('throws when NODE_ENV is invalid', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'staging',
        DATABASE_URL: 'postgresql://u:p@localhost:5432/alumbra',
      }),
    ).toThrow(/NODE_ENV/);
  });
});
```

Also create a minimal `jest.config.js` at the root before running:

Create `jest.config.js`:

```js
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  collectCoverageFrom: ['src/**/*.(t|j)s'],
  coverageDirectory: './coverage',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
};
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/config/env.schema.spec.ts`
Expected: FAIL (module `./env.schema` not found).

- [ ] **Step 3: Create `src/config/env.schema.ts`**

```ts
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(input: Record<string, unknown>): Env {
  const result = envSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `- ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return result.data;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/config/env.schema.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Create `src/config/config.module.ts`**

```ts
import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { validateEnv } from './env.schema';

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      validate: (raw) => validateEnv(raw),
      cache: true,
    }),
  ],
  exports: [NestConfigModule],
})
export class ConfigModule {}
```

- [ ] **Step 6: Wire it into `src/app.module.ts`**

Replace file contents:

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';

@Module({
  imports: [ConfigModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
```

- [ ] **Step 7: Create `.env.example`**

```
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://alumbra:password@localhost:5432/alumbra?schema=public
```

- [ ] **Step 8: Sanity-boot with a copied `.env`**

Run:
```bash
cp .env.example .env
pnpm build
```
Expected: compiles without errors.

If you want to prove validation works, temporarily break `.env` (remove `DATABASE_URL`), run `pnpm start`, observe the process exits with the Zod error message, then restore `.env`. This is optional — the unit test already covers the behavior.

- [ ] **Step 9: Commit**

```bash
git add src/config jest.config.js src/app.module.ts .env.example
git commit -m "feat: add config module with zod env validation"
```

---

## Task 1.5: Add Prisma with a placeholder `Health` model

**Files:**
- Create: `prisma/schema.prisma`
- Create: `src/prisma/prisma.module.ts`
- Create: `src/prisma/prisma.service.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Create `prisma/schema.prisma`**

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

- [ ] **Step 2: Generate the Prisma client**

Run: `pnpm prisma:generate`
Expected: "Generated Prisma Client (…) to ./node_modules/@prisma/client".

- [ ] **Step 3: Create `src/prisma/prisma.service.ts`**

```ts
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
```

- [ ] **Step 4: Create `src/prisma/prisma.module.ts`**

```ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

- [ ] **Step 5: Register `PrismaModule` in `src/app.module.ts`**

Replace file contents:

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [ConfigModule, PrismaModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
```

- [ ] **Step 6: Apply the migration**

Run: `pnpm prisma:migrate --name init_health`
Expected: Prisma creates `prisma/migrations/…_init_health/migration.sql`, applies it, shows "Your database is now in sync".

If Prisma cannot reach the database, stop and tell the user: "La migración no pudo conectarse a la DB con `DATABASE_URL=...`. Confírmame que la DB está arriba y accesible antes de continuar."

- [ ] **Step 7: Verify the app still boots**

Run: `pnpm start` (Ctrl+C after boot log).
Expected: logs `Prisma connected` and `Alumbra backend listening on http://localhost:3000`.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/prisma src/app.module.ts
git commit -m "feat: add prisma with Health placeholder model"
```

---

## Task 1.6: Add GraphQL with a `ping` health resolver

**Files:**
- Create: `src/health/health.module.ts`
- Create: `src/health/health.resolver.ts`
- Create: `src/health/health.resolver.spec.ts`
- Create: `src/graphql/schema.gql` (generated on first boot)
- Modify: `src/app.module.ts`

- [ ] **Step 1: Write the failing test `src/health/health.resolver.spec.ts`**

```ts
import { Test } from '@nestjs/testing';
import { HealthResolver } from './health.resolver';
import { PrismaService } from '../prisma/prisma.service';

describe('HealthResolver', () => {
  let resolver: HealthResolver;
  let prisma: { $queryRaw: jest.Mock };

  beforeEach(async () => {
    prisma = { $queryRaw: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        HealthResolver,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    resolver = module.get(HealthResolver);
  });

  it('returns "pong" when the DB responds', async () => {
    prisma.$queryRaw.mockResolvedValue([{ ok: 1 }]);
    await expect(resolver.ping()).resolves.toBe('pong');
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });

  it('propagates the error when the DB is down', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('connection refused'));
    await expect(resolver.ping()).rejects.toThrow('connection refused');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/health/health.resolver.spec.ts`
Expected: FAIL (cannot find module `./health.resolver`).

- [ ] **Step 3: Create `src/health/health.resolver.ts`**

```ts
import { Query, Resolver } from '@nestjs/graphql';
import { PrismaService } from '../prisma/prisma.service';

@Resolver()
export class HealthResolver {
  constructor(private readonly prisma: PrismaService) {}

  @Query(() => String, { description: 'Health check: returns "pong" if DB is reachable.' })
  async ping(): Promise<string> {
    await this.prisma.$queryRaw`SELECT 1`;
    return 'pong';
  }
}
```

- [ ] **Step 4: Create `src/health/health.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { HealthResolver } from './health.resolver';

@Module({
  providers: [HealthResolver],
})
export class HealthModule {}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test src/health/health.resolver.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Register GraphQL + Health in `src/app.module.ts`**

Replace file contents. `introspection` is gated on `NODE_ENV !== 'production'` so Apollo Sandbox is only served in dev/test (per the scaffold spec).

```ts
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { join } from 'path';
import { ConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      useFactory: () => ({
        autoSchemaFile: join(process.cwd(), 'src/graphql/schema.gql'),
        sortSchema: true,
        playground: false,
        introspection: process.env.NODE_ENV !== 'production',
        path: '/graphql',
      }),
    }),
    HealthModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 7: Boot and verify Apollo Sandbox**

Run: `pnpm start` (keep running for the next two sub-steps).

In a separate terminal:
```bash
curl -s -X POST http://localhost:3000/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"{ ping }"}'
```
Expected response: `{"data":{"ping":"pong"}}`.

Also confirm `src/graphql/schema.gql` was generated and contains `type Query { ping: String! }` (after sortSchema, it'll be a sorted SDL file).

Stop the server (Ctrl+C).

- [ ] **Step 8: Commit**

```bash
git add src/health src/graphql src/app.module.ts
git commit -m "feat: add graphql with ping health resolver"
```

---

## Task 1.7: E2E test for `ping`

**Files:**
- Create: `test/jest-e2e.json`
- Create: `test/app.e2e-spec.ts`

- [ ] **Step 1: Create `test/jest-e2e.json`**

```json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": ".",
  "testEnvironment": "node",
  "testRegex": ".e2e-spec.ts$",
  "transform": {
    "^.+\\.(t|j)s$": "ts-jest"
  },
  "moduleNameMapper": {
    "^@/(.*)$": "<rootDir>/../src/$1"
  }
}
```

- [ ] **Step 2: Create `test/app.e2e-spec.ts`**

```ts
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('GraphQL /graphql (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('ping returns "pong"', async () => {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({ query: '{ ping }' })
      .expect(200);

    expect(response.body).toEqual({ data: { ping: 'pong' } });
  });
});
```

- [ ] **Step 3: Run E2E**

Ensure `.env` is configured and the DB is reachable. Run: `pnpm test:e2e`
Expected: PASS.

If the DB is unreachable, the test will fail at `PrismaService.onModuleInit`. That's the correct behavior — fix the DB connection and retry.

- [ ] **Step 4: Commit**

```bash
git add test/
git commit -m "test: add e2e test for ping query"
```

---

## Task 1.8: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create `README.md`**

````markdown
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
# Editar .env si hace falta
pnpm prisma:migrate      # aplica migraciones
pnpm prisma:seed         # crea datos iniciales (más adelante)
pnpm dev                 # arranca en http://localhost:3000
```

## Comprobar GraphQL

Abrir `http://localhost:3000/graphql` en el navegador para ver Apollo Sandbox, y ejecutar:

```graphql
{ ping }
```

Debe devolver `"pong"`.

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

## Crear el primer pastor

Una vez aplicadas las migraciones de Spec A:

```bash
pnpm tsx scripts/create-pastor.ts --email jane@example.com --firstName Jane --lastName Doe
```

## Spec docs

- Scaffold: `docs/superpowers/specs/2026-04-21-backend-scaffold-design.md`
- Spec A (users/roles/ministries): `docs/superpowers/specs/2026-04-21-spec-a-users-roles-ministries-design.md`
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with setup and scripts"
```

---

## Phase 1 verification

- [ ] Run: `pnpm build` → compiles without errors.
- [ ] Run: `pnpm test` → all unit tests pass.
- [ ] Run: `pnpm test:e2e` → E2E passes.
- [ ] Manual: `pnpm dev`, visit `http://localhost:3000/graphql`, execute `{ ping }`, see `"pong"`.

If all four pass, Phase 1 is done.

---

# Phase 2 — Spec A (Users, Roles, Ministries)

After Phase 2 the API supports creating users and ministries, adding/removing users from ministries, soft-deleting users, and listing/filtering all of the above. Acogida is seeded. The first pastor is created via CLI.

---

## Task 2.1: Replace `Health` with Spec A models in the Prisma schema

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Replace `prisma/schema.prisma` contents**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum BaseRole {
  ASISTENTE
  MIEMBRO
}

enum MinistryRole {
  LEADER
  MEMBER
}

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
```

Note: the `Health` model is removed. This means the placeholder table will be dropped in the migration.

- [ ] **Step 2: Create the migration**

Run: `pnpm prisma:migrate --name spec_a_users_roles_ministries`
Expected: Prisma detects drop of `Health` + create of new tables, generates SQL, applies it. Confirm with `y` if prompted about data loss (the `Health` table is empty).

- [ ] **Step 3: Regenerate client**

Run: `pnpm prisma:generate`
Expected: types for `User`, `Ministry`, `MinistryMembership`, `BaseRole`, `MinistryRole` now available.

- [ ] **Step 4: Delete the now-dead health resolver**

Remove files: `src/health/health.module.ts`, `src/health/health.resolver.ts`, `src/health/health.resolver.spec.ts`.

Run:
```bash
rm -r src/health
```

- [ ] **Step 5: Update `src/app.module.ts` to drop `HealthModule`**

Replace file contents:

```ts
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { join } from 'path';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      useFactory: () => ({
        autoSchemaFile: join(process.cwd(), 'src/graphql/schema.gql'),
        sortSchema: true,
        playground: false,
        introspection: process.env.NODE_ENV !== 'production',
        path: '/graphql',
      }),
    }),
  ],
})
export class AppModule {}
```

The GraphQL schema is now empty of queries, so we need a placeholder until Task 2.7 registers the `User` queries. Add a `src/app.resolver.ts` temporary:

Create `src/app.resolver.ts`:

```ts
import { Query, Resolver } from '@nestjs/graphql';

@Resolver()
export class AppResolver {
  @Query(() => String, { description: 'Placeholder until the first real queries ship.' })
  apiVersion(): string {
    return '0.0.1';
  }
}
```

And register it in `app.module.ts` (add to providers):

```ts
// … imports …
import { AppResolver } from './app.resolver';

@Module({
  imports: [ /* … as above … */ ],
  providers: [AppResolver],
})
export class AppModule {}
```

Also update `test/app.e2e-spec.ts` to query `{ apiVersion }` instead of `{ ping }`:

Replace the "ping returns pong" test:

```ts
  it('apiVersion returns a string', async () => {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({ query: '{ apiVersion }' })
      .expect(200);

    expect(response.body.data.apiVersion).toEqual(expect.any(String));
  });
```

Rename the `describe` accordingly.

- [ ] **Step 6: Verify build and E2E still pass**

Run: `pnpm build && pnpm test && pnpm test:e2e`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/app.module.ts src/app.resolver.ts src/health test/app.e2e-spec.ts
git commit -m "feat: replace health placeholder with spec A prisma schema"
```

(The `src/health` delete is included in the commit automatically because git tracks deletes via `git add`.)

---

## Task 2.2: Soft-delete middleware for `User`

**Files:**
- Modify: `src/prisma/prisma.service.ts`
- Test: `src/prisma/prisma.service.spec.ts`

- [ ] **Step 1: Write the failing test `src/prisma/prisma.service.spec.ts`**

```ts
import { PrismaService } from './prisma.service';

describe('PrismaService soft-delete middleware for User', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    // Clean slate for the test
    await prisma.user.deleteMany({}).catch(() => {
      // deleteMany is intercepted; fall back to raw delete if the DB has leftovers
    });
    await prisma.$executeRawUnsafe('DELETE FROM "User"');
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe('DELETE FROM "User"');
    await prisma.$disconnect();
  });

  it('delete on User sets deletedAt instead of removing the row', async () => {
    const user = await prisma.user.create({
      data: { email: 'soft@example.com', firstName: 'Soft', lastName: 'Del' },
    });

    await prisma.user.delete({ where: { id: user.id } });

    const raw = await prisma.$queryRawUnsafe<Array<{ id: string; deletedAt: Date | null }>>(
      `SELECT id, "deletedAt" FROM "User" WHERE id = $1`,
      user.id,
    );
    expect(raw).toHaveLength(1);
    expect(raw[0].deletedAt).toBeInstanceOf(Date);
  });

  it('findMany excludes soft-deleted users by default', async () => {
    const a = await prisma.user.create({
      data: { email: 'alive@example.com', firstName: 'Alive', lastName: 'User' },
    });
    const b = await prisma.user.create({
      data: { email: 'dead@example.com', firstName: 'Dead', lastName: 'User' },
    });
    await prisma.user.delete({ where: { id: b.id } });

    const users = await prisma.user.findMany();
    const ids = users.map((u) => u.id);
    expect(ids).toContain(a.id);
    expect(ids).not.toContain(b.id);
  });

  it('findMany with explicit deletedAt filter is respected', async () => {
    const users = await prisma.user.findMany({ where: { deletedAt: { not: null } } });
    expect(users.length).toBeGreaterThan(0);
  });
});
```

This test hits a real database. Ensure `.env` has `DATABASE_URL` set to a DB where you don't care about pre-existing `User` rows (in practice, the dev DB is fine because it's only been seeded so far).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/prisma/prisma.service.spec.ts`
Expected: the `delete` test fails — the row is actually gone, `raw` returns `[]`.

- [ ] **Step 3: Add middleware to `src/prisma/prisma.service.ts`**

Replace the file:

```ts
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super();
    this.installSoftDeleteMiddleware();
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  private installSoftDeleteMiddleware(): void {
    this.$use(async (params, next) => {
      if (params.model !== 'User') {
        return next(params);
      }

      if (params.action === 'delete') {
        params.action = 'update';
        params.args = {
          ...params.args,
          data: { deletedAt: new Date() },
        };
        return next(params);
      }

      if (params.action === 'deleteMany') {
        params.action = 'updateMany';
        params.args = {
          ...params.args,
          data: { deletedAt: new Date() },
        };
        return next(params);
      }

      if (params.action === 'findMany' || params.action === 'findFirst' || params.action === 'count') {
        params.args = params.args ?? {};
        const where = (params.args.where ?? {}) as Prisma.UserWhereInput;
        if (where.deletedAt === undefined) {
          params.args.where = { ...where, deletedAt: null };
        }
        return next(params);
      }

      if (params.action === 'findUnique' || params.action === 'findUniqueOrThrow') {
        // findUnique cannot accept deletedAt in `where`. Convert to findFirst.
        params.action = 'findFirst';
        const where = (params.args?.where ?? {}) as Prisma.UserWhereInput;
        params.args = { ...params.args, where: { ...where, deletedAt: null } };
        return next(params);
      }

      return next(params);
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/prisma/prisma.service.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Re-run other tests to ensure no regressions**

Run: `pnpm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/prisma/prisma.service.ts src/prisma/prisma.service.spec.ts
git commit -m "feat(prisma): add soft-delete middleware for User"
```

---

## Task 2.3: Common pagination types

**Files:**
- Create: `src/common/pagination/page-info.type.ts`
- Create: `src/common/pagination/pagination.input.ts`
- Create: `src/common/pagination/encode-cursor.ts`
- Test: `src/common/pagination/encode-cursor.spec.ts`

This is a minimal cursor-paginated primitive. We encode the row's `id` as the cursor (base64 of `id`). `first` is required; `after` is optional.

- [ ] **Step 1: Write the failing test `src/common/pagination/encode-cursor.spec.ts`**

```ts
import { decodeCursor, encodeCursor } from './encode-cursor';

describe('cursor encoding', () => {
  it('round-trips an id', () => {
    const id = 'clq1234abc';
    expect(decodeCursor(encodeCursor(id))).toBe(id);
  });

  it('throws when decoding garbage', () => {
    expect(() => decodeCursor('%%%not-base64%%%')).toThrow(/invalid cursor/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/common/pagination/encode-cursor.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Create `src/common/pagination/encode-cursor.ts`**

```ts
export function encodeCursor(id: string): string {
  return Buffer.from(id, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): string {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    if (!decoded) {
      throw new Error('invalid cursor');
    }
    return decoded;
  } catch {
    throw new Error('invalid cursor');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/common/pagination/encode-cursor.spec.ts`
Expected: PASS.

- [ ] **Step 5: Create `src/common/pagination/page-info.type.ts`**

```ts
import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class PageInfo {
  @Field(() => Boolean)
  hasNextPage!: boolean;

  @Field(() => String, { nullable: true })
  endCursor?: string | null;
}
```

- [ ] **Step 6: Create `src/common/pagination/pagination.input.ts`**

```ts
import { Field, InputType, Int } from '@nestjs/graphql';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

@InputType()
export class PaginationInput {
  @Field(() => Int, { defaultValue: 20 })
  @IsInt()
  @Min(1)
  @Max(100)
  first: number = 20;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  after?: string;
}
```

Note: `class-validator` is used lightly for input decorators. If it isn't installed yet:

Run: `pnpm add class-validator class-transformer`

- [ ] **Step 7: Commit**

```bash
git add src/common/pagination package.json pnpm-lock.yaml
git commit -m "feat(common): cursor pagination primitives"
```

---

## Task 2.4: User GraphQL model and Zod input schemas

**Files:**
- Create: `src/users/dto/user.model.ts`
- Create: `src/users/dto/base-role.enum.ts`
- Create: `src/users/dto/create-user.input.ts`
- Create: `src/users/dto/update-user.input.ts`
- Create: `src/users/dto/user-filter.input.ts`
- Create: `src/users/dto/user-connection.type.ts`
- Create: `src/users/dto/inputs.schema.ts` (Zod)
- Test: `src/users/dto/inputs.schema.spec.ts`

- [ ] **Step 1: Register the enum GraphQL type — `src/users/dto/base-role.enum.ts`**

```ts
import { registerEnumType } from '@nestjs/graphql';
import { BaseRole } from '@prisma/client';

registerEnumType(BaseRole, { name: 'BaseRole' });

export { BaseRole };
```

- [ ] **Step 2: Create `src/users/dto/user.model.ts`**

```ts
import { Field, ID, ObjectType } from '@nestjs/graphql';
import { BaseRole } from './base-role.enum';

@ObjectType('User')
export class UserModel {
  @Field(() => ID)
  id!: string;

  @Field()
  email!: string;

  @Field()
  firstName!: string;

  @Field()
  lastName!: string;

  @Field({ description: 'Computed: firstName + " " + lastName.' })
  fullName!: string;

  @Field(() => BaseRole)
  baseRole!: BaseRole;

  @Field(() => Boolean)
  isPastor!: boolean;

  @Field({ nullable: true })
  phone?: string | null;

  @Field({ nullable: true })
  photoUrl?: string | null;

  @Field(() => Date, { nullable: true })
  birthDate?: Date | null;

  @Field(() => Date)
  createdAt!: Date;
}
```

- [ ] **Step 3: Create `src/users/dto/create-user.input.ts`**

```ts
import { Field, InputType } from '@nestjs/graphql';

@InputType()
export class CreateUserInput {
  @Field()
  email!: string;

  @Field()
  firstName!: string;

  @Field()
  lastName!: string;

  @Field({ nullable: true })
  phone?: string;

  @Field(() => Date, { nullable: true })
  birthDate?: Date;
}
```

- [ ] **Step 4: Create `src/users/dto/update-user.input.ts`**

```ts
import { Field, InputType } from '@nestjs/graphql';

@InputType()
export class UpdateUserInput {
  @Field({ nullable: true })
  firstName?: string;

  @Field({ nullable: true })
  lastName?: string;

  @Field({ nullable: true })
  phone?: string | null;

  @Field({ nullable: true })
  photoUrl?: string | null;

  @Field(() => Date, { nullable: true })
  birthDate?: Date | null;
}
```

- [ ] **Step 5: Create `src/users/dto/user-filter.input.ts`**

```ts
import { Field, InputType } from '@nestjs/graphql';
import { BaseRole } from './base-role.enum';

@InputType()
export class UserFilterInput {
  @Field(() => BaseRole, { nullable: true })
  baseRole?: BaseRole;

  @Field(() => Boolean, { nullable: true })
  isPastor?: boolean;

  @Field(() => String, { nullable: true })
  ministryId?: string;

  @Field(() => String, { nullable: true })
  search?: string;
}
```

- [ ] **Step 6: Create `src/users/dto/user-connection.type.ts`**

```ts
import { Field, ObjectType } from '@nestjs/graphql';
import { PageInfo } from '../../common/pagination/page-info.type';
import { UserModel } from './user.model';

@ObjectType('UserEdge')
export class UserEdge {
  @Field(() => UserModel)
  node!: UserModel;

  @Field()
  cursor!: string;
}

@ObjectType('UserConnection')
export class UserConnection {
  @Field(() => [UserEdge])
  edges!: UserEdge[];

  @Field(() => PageInfo)
  pageInfo!: PageInfo;
}
```

- [ ] **Step 7: Write the failing test for Zod input schemas — `src/users/dto/inputs.schema.spec.ts`**

```ts
import { createUserSchema, updateUserSchema } from './inputs.schema';

describe('createUserSchema', () => {
  it('accepts a valid input and lowercases the email', () => {
    const result = createUserSchema.parse({
      email: 'JANE@EXAMPLE.COM',
      firstName: 'Jane',
      lastName: 'Doe',
    });
    expect(result.email).toBe('jane@example.com');
  });

  it('rejects an invalid email', () => {
    expect(() =>
      createUserSchema.parse({ email: 'not-email', firstName: 'J', lastName: 'D' }),
    ).toThrow();
  });

  it('rejects empty firstName', () => {
    expect(() =>
      createUserSchema.parse({ email: 'a@b.com', firstName: '', lastName: 'D' }),
    ).toThrow();
  });
});

describe('updateUserSchema', () => {
  it('allows all fields to be absent', () => {
    const result = updateUserSchema.parse({});
    expect(result).toEqual({});
  });

  it('allows nulling phone', () => {
    const result = updateUserSchema.parse({ phone: null });
    expect(result.phone).toBeNull();
  });
});
```

- [ ] **Step 8: Run test to verify it fails**

Run: `pnpm test src/users/dto/inputs.schema.spec.ts`
Expected: FAIL (module not found).

- [ ] **Step 9: Create `src/users/dto/inputs.schema.ts`**

```ts
import { z } from 'zod';

export const createUserSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .transform((v) => v.toLowerCase()),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  phone: z.string().trim().min(3).max(30).optional(),
  birthDate: z.coerce.date().optional(),
});

export type CreateUserData = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
  phone: z.string().trim().min(3).max(30).nullable().optional(),
  photoUrl: z.string().url().nullable().optional(),
  birthDate: z.coerce.date().nullable().optional(),
});

export type UpdateUserData = z.infer<typeof updateUserSchema>;
```

- [ ] **Step 10: Run test to verify it passes**

Run: `pnpm test src/users/dto/inputs.schema.spec.ts`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/users
git commit -m "feat(users): graphql types and zod input schemas"
```

---

## Task 2.5: `UsersService` — CRUD + listing

**Files:**
- Create: `src/users/users.service.ts`
- Test: `src/users/users.service.spec.ts`

Tests use a real DB (integration flavor) because mocking Prisma here would test little.

- [ ] **Step 1: Write the failing test `src/users/users.service.spec.ts`**

```ts
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [UsersService, PrismaService],
    }).compile();

    service = moduleRef.get(UsersService);
    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();
    await prisma.$executeRawUnsafe('DELETE FROM "MinistryMembership"');
    await prisma.$executeRawUnsafe('DELETE FROM "User"');
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe('DELETE FROM "MinistryMembership"');
    await prisma.$executeRawUnsafe('DELETE FROM "User"');
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('DELETE FROM "MinistryMembership"');
    await prisma.$executeRawUnsafe('DELETE FROM "User"');
  });

  it('creates a user with base role ASISTENTE and normalized email', async () => {
    const u = await service.create({ email: 'JANE@EXAMPLE.COM', firstName: 'Jane', lastName: 'Doe' });
    expect(u.email).toBe('jane@example.com');
    expect(u.baseRole).toBe('ASISTENTE');
    expect(u.isPastor).toBe(false);
  });

  it('rejects duplicate emails (case-insensitive)', async () => {
    await service.create({ email: 'jane@example.com', firstName: 'Jane', lastName: 'Doe' });
    await expect(
      service.create({ email: 'JANE@example.com', firstName: 'J', lastName: 'D' }),
    ).rejects.toThrow(/email/i);
  });

  it('updateById applies changes', async () => {
    const u = await service.create({ email: 'a@b.com', firstName: 'A', lastName: 'B' });
    const updated = await service.updateById(u.id, { firstName: 'Ana' });
    expect(updated.firstName).toBe('Ana');
  });

  it('softDelete marks deletedAt and the user is not findable afterwards', async () => {
    const u = await service.create({ email: 'x@y.com', firstName: 'X', lastName: 'Y' });
    await service.softDelete(u.id);
    await expect(service.findById(u.id)).resolves.toBeNull();
  });

  it('setPastor toggles isPastor', async () => {
    const u = await service.create({ email: 'p@p.com', firstName: 'P', lastName: 'P' });
    const updated = await service.setPastor(u.id, true);
    expect(updated.isPastor).toBe(true);
  });

  it('list returns paginated users ordered by createdAt desc, then id desc', async () => {
    for (let i = 0; i < 5; i++) {
      await service.create({ email: `u${i}@x.com`, firstName: `U${i}`, lastName: 'X' });
    }
    const page1 = await service.list({}, { first: 2 });
    expect(page1.edges).toHaveLength(2);
    expect(page1.pageInfo.hasNextPage).toBe(true);

    const page2 = await service.list({}, { first: 2, after: page1.pageInfo.endCursor! });
    expect(page2.edges).toHaveLength(2);
    const idsPage1 = page1.edges.map((e) => e.node.id);
    const idsPage2 = page2.edges.map((e) => e.node.id);
    expect(idsPage1).not.toContain(idsPage2[0]);
  });

  it('list filters by search (email/name)', async () => {
    await service.create({ email: 'ana@x.com', firstName: 'Ana', lastName: 'Luz' });
    await service.create({ email: 'bob@x.com', firstName: 'Bob', lastName: 'Stone' });
    const result = await service.list({ search: 'ana' }, { first: 10 });
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].node.email).toBe('ana@x.com');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/users/users.service.spec.ts`
Expected: FAIL (`UsersService` not found).

- [ ] **Step 3: Create `src/users/users.service.ts`**

```ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaginationInput } from '../common/pagination/pagination.input';
import { decodeCursor, encodeCursor } from '../common/pagination/encode-cursor';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateUserData,
  UpdateUserData,
  createUserSchema,
  updateUserSchema,
} from './dto/inputs.schema';
import { UserConnection } from './dto/user-connection.type';
import { UserFilterInput } from './dto/user-filter.input';

type UserRow = Prisma.UserGetPayload<{}>;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(raw: unknown): Promise<UserRow> {
    const data = createUserSchema.parse(raw) satisfies CreateUserData;
    try {
      return await this.prisma.user.create({ data });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`A user with email "${data.email}" already exists.`);
      }
      throw e;
    }
  }

  async findById(id: string): Promise<UserRow | null> {
    return this.prisma.user.findFirst({ where: { id } });
  }

  async findByIdOrThrow(id: string): Promise<UserRow> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException(`User ${id} not found.`);
    return user;
  }

  async updateById(id: string, raw: unknown): Promise<UserRow> {
    const data = updateUserSchema.parse(raw) satisfies UpdateUserData;
    await this.findByIdOrThrow(id);
    return this.prisma.user.update({ where: { id }, data });
  }

  async softDelete(id: string): Promise<UserRow> {
    await this.findByIdOrThrow(id);
    await this.prisma.user.delete({ where: { id } });
    // After soft-delete the user is not returned by findFirst. Return raw row for confirmation.
    const [row] = await this.prisma.$queryRaw<UserRow[]>`
      SELECT * FROM "User" WHERE id = ${id}
    `;
    return row;
  }

  async setPastor(id: string, isPastor: boolean): Promise<UserRow> {
    await this.findByIdOrThrow(id);
    return this.prisma.user.update({ where: { id }, data: { isPastor } });
  }

  async list(filter: UserFilterInput, page: PaginationInput): Promise<UserConnection> {
    const take = page.first + 1; // fetch one extra to detect next page
    const where: Prisma.UserWhereInput = {};

    if (filter.baseRole) where.baseRole = filter.baseRole;
    if (filter.isPastor !== undefined) where.isPastor = filter.isPastor;
    if (filter.ministryId) {
      where.ministryMemberships = {
        some: { ministryId: filter.ministryId, leftAt: null },
      };
    }
    if (filter.search) {
      const q = filter.search.trim();
      where.OR = [
        { email: { contains: q, mode: 'insensitive' } },
        { firstName: { contains: q, mode: 'insensitive' } },
        { lastName: { contains: q, mode: 'insensitive' } },
      ];
    }

    const rows = await this.prisma.user.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      ...(page.after
        ? { cursor: { id: decodeCursor(page.after) }, skip: 1 }
        : {}),
    });

    const hasNextPage = rows.length > page.first;
    const slice = rows.slice(0, page.first);

    return {
      edges: slice.map((node) => ({ node: toModel(node), cursor: encodeCursor(node.id) })),
      pageInfo: {
        hasNextPage,
        endCursor: slice.length ? encodeCursor(slice[slice.length - 1].id) : null,
      },
    };
  }
}

function toModel(u: UserRow) {
  return {
    ...u,
    fullName: `${u.firstName} ${u.lastName}`,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/users/users.service.spec.ts`
Expected: PASS (7 tests). If a test fails, debug the specific behavior — don't move on until green.

- [ ] **Step 5: Commit**

```bash
git add src/users/users.service.ts src/users/users.service.spec.ts
git commit -m "feat(users): UsersService with CRUD and paginated list"
```

---

## Task 2.6: `UsersResolver` + `UsersModule`

**Files:**
- Create: `src/users/users.resolver.ts`
- Create: `src/users/users.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Create `src/users/users.resolver.ts`**

```ts
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { PaginationInput } from '../common/pagination/pagination.input';
import { CreateUserInput } from './dto/create-user.input';
import { UpdateUserInput } from './dto/update-user.input';
import { UserConnection } from './dto/user-connection.type';
import { UserFilterInput } from './dto/user-filter.input';
import { UserModel } from './dto/user.model';
import { UsersService } from './users.service';

function toModel(u: {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  baseRole: 'ASISTENTE' | 'MIEMBRO';
  isPastor: boolean;
  phone: string | null;
  photoUrl: string | null;
  birthDate: Date | null;
  createdAt: Date;
}): UserModel {
  return { ...u, fullName: `${u.firstName} ${u.lastName}` };
}

@Resolver(() => UserModel)
export class UsersResolver {
  constructor(private readonly users: UsersService) {}

  @Query(() => UserModel, { nullable: true })
  async user(@Args('id', { type: () => ID }) id: string): Promise<UserModel | null> {
    const u = await this.users.findById(id);
    return u ? toModel(u) : null;
  }

  @Query(() => UserConnection)
  async users(
    @Args('filter', { nullable: true }) filter?: UserFilterInput,
    @Args('pagination', { nullable: true }) pagination?: PaginationInput,
  ): Promise<UserConnection> {
    return this.users.list(filter ?? {}, pagination ?? { first: 20 });
  }

  @Mutation(() => UserModel)
  async createUser(@Args('input') input: CreateUserInput): Promise<UserModel> {
    const u = await this.users.create(input);
    return toModel(u);
  }

  @Mutation(() => UserModel)
  async updateUser(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateUserInput,
  ): Promise<UserModel> {
    const u = await this.users.updateById(id, input);
    return toModel(u);
  }

  @Mutation(() => UserModel)
  async softDeleteUser(@Args('id', { type: () => ID }) id: string): Promise<UserModel> {
    const u = await this.users.softDelete(id);
    return toModel(u);
  }

  @Mutation(() => UserModel)
  async setUserPastor(
    @Args('id', { type: () => ID }) id: string,
    @Args('isPastor') isPastor: boolean,
  ): Promise<UserModel> {
    const u = await this.users.setPastor(id, isPastor);
    return toModel(u);
  }
}
```

- [ ] **Step 2: Create `src/users/users.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { UsersResolver } from './users.resolver';
import { UsersService } from './users.service';

@Module({
  providers: [UsersResolver, UsersService],
  exports: [UsersService],
})
export class UsersModule {}
```

- [ ] **Step 3: Wire `UsersModule` into `AppModule`**

Modify `src/app.module.ts` — add `UsersModule` to imports:

```ts
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { join } from 'path';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { AppResolver } from './app.resolver';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      useFactory: () => ({
        autoSchemaFile: join(process.cwd(), 'src/graphql/schema.gql'),
        sortSchema: true,
        playground: false,
        introspection: process.env.NODE_ENV !== 'production',
        path: '/graphql',
      }),
    }),
    UsersModule,
  ],
  providers: [AppResolver],
})
export class AppModule {}
```

- [ ] **Step 4: Boot and verify schema generates**

Run: `pnpm start` (Ctrl+C after Prisma connects).

Check that `src/graphql/schema.gql` now contains `type User`, `input CreateUserInput`, `Query.user`, `Query.users`, `Mutation.createUser`, etc.

- [ ] **Step 5: Commit**

```bash
git add src/users/users.resolver.ts src/users/users.module.ts src/app.module.ts src/graphql/schema.gql
git commit -m "feat(users): graphql resolver and module"
```

---

## Task 2.7: Ministry GraphQL types and Zod schemas

**Files:**
- Create: `src/ministries/dto/ministry-role.enum.ts`
- Create: `src/ministries/dto/ministry.model.ts`
- Create: `src/ministries/dto/ministry-membership.model.ts`
- Create: `src/ministries/dto/create-ministry.input.ts`
- Create: `src/ministries/dto/update-ministry.input.ts`
- Create: `src/ministries/dto/add-user-to-ministry.input.ts`
- Create: `src/ministries/dto/inputs.schema.ts`
- Test: `src/ministries/dto/inputs.schema.spec.ts`

- [ ] **Step 1: Create `src/ministries/dto/ministry-role.enum.ts`**

```ts
import { registerEnumType } from '@nestjs/graphql';
import { MinistryRole } from '@prisma/client';

registerEnumType(MinistryRole, { name: 'MinistryRole' });

export { MinistryRole };
```

- [ ] **Step 2: Create `src/ministries/dto/ministry.model.ts`**

```ts
import { Field, ID, ObjectType } from '@nestjs/graphql';

@ObjectType('Ministry')
export class MinistryModel {
  @Field(() => ID)
  id!: string;

  @Field()
  slug!: string;

  @Field()
  name!: string;

  @Field({ nullable: true })
  description?: string | null;

  @Field(() => Date, { nullable: true })
  archivedAt?: Date | null;

  @Field(() => Date)
  createdAt!: Date;
}
```

- [ ] **Step 3: Create `src/ministries/dto/ministry-membership.model.ts`**

```ts
import { Field, ID, ObjectType } from '@nestjs/graphql';
import { UserModel } from '../../users/dto/user.model';
import { MinistryRole } from './ministry-role.enum';
import { MinistryModel } from './ministry.model';

@ObjectType('MinistryMembership')
export class MinistryMembershipModel {
  @Field(() => ID)
  id!: string;

  @Field(() => UserModel)
  user!: UserModel;

  @Field(() => MinistryModel)
  ministry!: MinistryModel;

  @Field(() => MinistryRole)
  role!: MinistryRole;

  @Field(() => Date)
  joinedAt!: Date;

  @Field(() => Date, { nullable: true })
  leftAt?: Date | null;
}
```

- [ ] **Step 4: Create `src/ministries/dto/create-ministry.input.ts`**

```ts
import { Field, InputType } from '@nestjs/graphql';

@InputType()
export class CreateMinistryInput {
  @Field()
  slug!: string;

  @Field()
  name!: string;

  @Field({ nullable: true })
  description?: string;
}
```

- [ ] **Step 5: Create `src/ministries/dto/update-ministry.input.ts`**

```ts
import { Field, InputType } from '@nestjs/graphql';

@InputType()
export class UpdateMinistryInput {
  @Field({ nullable: true })
  name?: string;

  @Field({ nullable: true })
  description?: string | null;
}
```

- [ ] **Step 6: Create `src/ministries/dto/add-user-to-ministry.input.ts`**

```ts
import { Field, ID, InputType } from '@nestjs/graphql';
import { MinistryRole } from './ministry-role.enum';

@InputType()
export class AddUserToMinistryInput {
  @Field(() => ID)
  userId!: string;

  @Field(() => ID)
  ministryId!: string;

  @Field(() => MinistryRole)
  role!: MinistryRole;
}
```

- [ ] **Step 7: Write the failing test `src/ministries/dto/inputs.schema.spec.ts`**

```ts
import { createMinistrySchema, updateMinistrySchema } from './inputs.schema';

describe('createMinistrySchema', () => {
  it('accepts a valid kebab slug', () => {
    const result = createMinistrySchema.parse({ slug: 'acogida', name: 'Acogida' });
    expect(result.slug).toBe('acogida');
  });

  it('rejects non-kebab slug', () => {
    expect(() => createMinistrySchema.parse({ slug: 'Acogida Ministry', name: 'x' })).toThrow();
    expect(() => createMinistrySchema.parse({ slug: 'ACOGIDA', name: 'x' })).toThrow();
  });
});

describe('updateMinistrySchema', () => {
  it('accepts empty input', () => {
    expect(updateMinistrySchema.parse({})).toEqual({});
  });
});
```

- [ ] **Step 8: Run test to verify it fails**

Run: `pnpm test src/ministries/dto/inputs.schema.spec.ts`
Expected: FAIL.

- [ ] **Step 9: Create `src/ministries/dto/inputs.schema.ts`**

```ts
import { z } from 'zod';

const slugRegex = /^[a-z][a-z0-9-]*$/;

export const createMinistrySchema = z.object({
  slug: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(slugRegex, 'must be kebab-case (lowercase letters, digits, hyphens)'),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
});

export const updateMinistrySchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
});

export type CreateMinistryData = z.infer<typeof createMinistrySchema>;
export type UpdateMinistryData = z.infer<typeof updateMinistrySchema>;
```

- [ ] **Step 10: Run test to verify it passes**

Run: `pnpm test src/ministries/dto/inputs.schema.spec.ts`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/ministries
git commit -m "feat(ministries): graphql types and zod input schemas"
```

---

## Task 2.8: `MinistriesService` + `MinistriesResolver` + memberships

**Files:**
- Create: `src/ministries/ministries.service.ts`
- Create: `src/ministries/ministries.resolver.ts`
- Create: `src/ministries/ministries.module.ts`
- Test: `src/ministries/ministries.service.spec.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Write the failing test `src/ministries/ministries.service.spec.ts`**

```ts
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { MinistriesService } from './ministries.service';

describe('MinistriesService', () => {
  let service: MinistriesService;
  let users: UsersService;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [MinistriesService, UsersService, PrismaService],
    }).compile();

    service = moduleRef.get(MinistriesService);
    users = moduleRef.get(UsersService);
    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe('DELETE FROM "MinistryMembership"');
    await prisma.$executeRawUnsafe('DELETE FROM "User"');
    await prisma.$executeRawUnsafe('DELETE FROM "Ministry"');
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('DELETE FROM "MinistryMembership"');
    await prisma.$executeRawUnsafe('DELETE FROM "User"');
    await prisma.$executeRawUnsafe('DELETE FROM "Ministry"');
  });

  it('creates a ministry with a unique slug', async () => {
    const m = await service.create({ slug: 'alabanza', name: 'Alabanza' });
    expect(m.slug).toBe('alabanza');
    await expect(
      service.create({ slug: 'alabanza', name: 'Duplicado' }),
    ).rejects.toThrow(/slug/i);
  });

  it('findBySlug excludes archived by default', async () => {
    const m = await service.create({ slug: 'jovenes', name: 'Jóvenes' });
    await service.archive(m.id);
    expect(await service.findBySlug('jovenes')).toBeNull();
    expect(await service.findBySlug('jovenes', { includeArchived: true })).not.toBeNull();
  });

  it('addMember creates an active membership, rejects duplicates', async () => {
    const m = await service.create({ slug: 'acogida', name: 'Acogida' });
    const u = await users.create({ email: 'a@b.com', firstName: 'A', lastName: 'B' });
    const mem = await service.addMember({ userId: u.id, ministryId: m.id, role: 'MEMBER' });
    expect(mem.leftAt).toBeNull();

    await expect(
      service.addMember({ userId: u.id, ministryId: m.id, role: 'MEMBER' }),
    ).rejects.toThrow(/active membership/i);
  });

  it('removeMember sets leftAt', async () => {
    const m = await service.create({ slug: 'acogida', name: 'Acogida' });
    const u = await users.create({ email: 'a@b.com', firstName: 'A', lastName: 'B' });
    const mem = await service.addMember({ userId: u.id, ministryId: m.id, role: 'MEMBER' });
    const removed = await service.removeMember(mem.id);
    expect(removed.leftAt).toBeInstanceOf(Date);
  });

  it('listMembers respects the includeLeft flag', async () => {
    const m = await service.create({ slug: 'acogida', name: 'Acogida' });
    const u1 = await users.create({ email: '1@x.com', firstName: 'A', lastName: 'B' });
    const u2 = await users.create({ email: '2@x.com', firstName: 'C', lastName: 'D' });
    const m1 = await service.addMember({ userId: u1.id, ministryId: m.id, role: 'MEMBER' });
    await service.addMember({ userId: u2.id, ministryId: m.id, role: 'LEADER' });
    await service.removeMember(m1.id);

    const active = await service.listMembers(m.id, {});
    expect(active).toHaveLength(1);

    const all = await service.listMembers(m.id, { includeLeft: true });
    expect(all).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/ministries/ministries.service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Create `src/ministries/ministries.service.ts`**

```ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Ministry, MinistryMembership, MinistryRole, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { createMinistrySchema, updateMinistrySchema } from './dto/inputs.schema';

@Injectable()
export class MinistriesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(raw: unknown): Promise<Ministry> {
    const data = createMinistrySchema.parse(raw);
    try {
      return await this.prisma.ministry.create({ data });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`A ministry with slug "${data.slug}" already exists.`);
      }
      throw e;
    }
  }

  async updateById(id: string, raw: unknown): Promise<Ministry> {
    const data = updateMinistrySchema.parse(raw);
    await this.findByIdOrThrow(id);
    return this.prisma.ministry.update({ where: { id }, data });
  }

  async findBySlug(slug: string, opts: { includeArchived?: boolean } = {}): Promise<Ministry | null> {
    const m = await this.prisma.ministry.findUnique({ where: { slug } });
    if (!m) return null;
    if (!opts.includeArchived && m.archivedAt) return null;
    return m;
  }

  async findById(id: string): Promise<Ministry | null> {
    return this.prisma.ministry.findUnique({ where: { id } });
  }

  async findByIdOrThrow(id: string): Promise<Ministry> {
    const m = await this.findById(id);
    if (!m) throw new NotFoundException(`Ministry ${id} not found.`);
    return m;
  }

  async list(opts: { includeArchived?: boolean } = {}): Promise<Ministry[]> {
    return this.prisma.ministry.findMany({
      where: opts.includeArchived ? {} : { archivedAt: null },
      orderBy: { name: 'asc' },
    });
  }

  async archive(id: string): Promise<Ministry> {
    await this.findByIdOrThrow(id);
    return this.prisma.ministry.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
  }

  async addMember(input: {
    userId: string;
    ministryId: string;
    role: MinistryRole;
  }): Promise<MinistryMembership> {
    const existingActive = await this.prisma.ministryMembership.findFirst({
      where: {
        userId: input.userId,
        ministryId: input.ministryId,
        leftAt: null,
      },
    });
    if (existingActive) {
      throw new ConflictException('User already has an active membership in this ministry.');
    }
    return this.prisma.ministryMembership.create({ data: input });
  }

  async removeMember(membershipId: string): Promise<MinistryMembership> {
    const m = await this.prisma.ministryMembership.findUnique({ where: { id: membershipId } });
    if (!m) throw new NotFoundException(`Membership ${membershipId} not found.`);
    if (m.leftAt) return m;
    return this.prisma.ministryMembership.update({
      where: { id: membershipId },
      data: { leftAt: new Date() },
    });
  }

  async listMembers(
    ministryId: string,
    opts: { role?: MinistryRole; includeLeft?: boolean } = {},
  ): Promise<MinistryMembership[]> {
    return this.prisma.ministryMembership.findMany({
      where: {
        ministryId,
        ...(opts.role ? { role: opts.role } : {}),
        ...(opts.includeLeft ? {} : { leftAt: null }),
      },
      orderBy: { joinedAt: 'desc' },
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/ministries/ministries.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Create `src/ministries/ministries.resolver.ts`**

```ts
import { Args, ID, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { UsersService } from '../users/users.service';
import { AddUserToMinistryInput } from './dto/add-user-to-ministry.input';
import { CreateMinistryInput } from './dto/create-ministry.input';
import { MinistryMembershipModel } from './dto/ministry-membership.model';
import { MinistryRole } from './dto/ministry-role.enum';
import { MinistryModel } from './dto/ministry.model';
import { UpdateMinistryInput } from './dto/update-ministry.input';
import { MinistriesService } from './ministries.service';

@Resolver(() => MinistryModel)
export class MinistriesResolver {
  constructor(
    private readonly ministries: MinistriesService,
    private readonly users: UsersService,
  ) {}

  @Query(() => MinistryModel, { nullable: true })
  async ministry(@Args('slug') slug: string): Promise<MinistryModel | null> {
    return this.ministries.findBySlug(slug);
  }

  @Query(() => [MinistryModel])
  async ministries(
    @Args('includeArchived', { defaultValue: false }) includeArchived: boolean,
  ): Promise<MinistryModel[]> {
    return this.ministries.list({ includeArchived });
  }

  @ResolveField(() => [MinistryMembershipModel])
  async members(
    @Parent() ministry: MinistryModel,
    @Args('role', { type: () => MinistryRole, nullable: true }) role?: MinistryRole,
    @Args('includeLeft', { defaultValue: false }) includeLeft?: boolean,
  ): Promise<MinistryMembershipModel[]> {
    const rows = await this.ministries.listMembers(ministry.id, { role, includeLeft });
    return Promise.all(
      rows.map(async (m) => ({
        id: m.id,
        role: m.role,
        joinedAt: m.joinedAt,
        leftAt: m.leftAt,
        user: toUserModel(await this.users.findByIdOrThrow(m.userId)),
        ministry,
      })),
    );
  }

  @Mutation(() => MinistryModel)
  async createMinistry(@Args('input') input: CreateMinistryInput): Promise<MinistryModel> {
    return this.ministries.create(input);
  }

  @Mutation(() => MinistryModel)
  async updateMinistry(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateMinistryInput,
  ): Promise<MinistryModel> {
    return this.ministries.updateById(id, input);
  }

  @Mutation(() => MinistryModel)
  async archiveMinistry(@Args('id', { type: () => ID }) id: string): Promise<MinistryModel> {
    return this.ministries.archive(id);
  }

  @Mutation(() => MinistryMembershipModel)
  async addUserToMinistry(
    @Args('input') input: AddUserToMinistryInput,
  ): Promise<MinistryMembershipModel> {
    const m = await this.ministries.addMember(input);
    const [user, ministry] = await Promise.all([
      this.users.findByIdOrThrow(m.userId),
      this.ministries.findByIdOrThrow(m.ministryId),
    ]);
    return {
      id: m.id,
      role: m.role,
      joinedAt: m.joinedAt,
      leftAt: m.leftAt,
      user: toUserModel(user),
      ministry,
    };
  }

  @Mutation(() => MinistryMembershipModel)
  async removeUserFromMinistry(
    @Args('membershipId', { type: () => ID }) membershipId: string,
  ): Promise<MinistryMembershipModel> {
    const m = await this.ministries.removeMember(membershipId);
    const [user, ministry] = await Promise.all([
      this.users.findByIdOrThrow(m.userId),
      this.ministries.findByIdOrThrow(m.ministryId),
    ]);
    return {
      id: m.id,
      role: m.role,
      joinedAt: m.joinedAt,
      leftAt: m.leftAt,
      user: toUserModel(user),
      ministry,
    };
  }
}

function toUserModel(u: {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  baseRole: 'ASISTENTE' | 'MIEMBRO';
  isPastor: boolean;
  phone: string | null;
  photoUrl: string | null;
  birthDate: Date | null;
  createdAt: Date;
}) {
  return { ...u, fullName: `${u.firstName} ${u.lastName}` };
}
```

- [ ] **Step 6: Create `src/ministries/ministries.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { MinistriesResolver } from './ministries.resolver';
import { MinistriesService } from './ministries.service';

@Module({
  imports: [UsersModule],
  providers: [MinistriesResolver, MinistriesService],
  exports: [MinistriesService],
})
export class MinistriesModule {}
```

- [ ] **Step 7: Register `MinistriesModule` in `AppModule`**

Add to imports in `src/app.module.ts`:

```ts
import { MinistriesModule } from './ministries/ministries.module';
// …
imports: [ /* existing */, UsersModule, MinistriesModule ],
```

- [ ] **Step 8: Boot and check schema**

Run: `pnpm start` (Ctrl+C after boot).

Confirm `src/graphql/schema.gql` now has `type Ministry`, `Mutation.addUserToMinistry`, etc.

- [ ] **Step 9: Commit**

```bash
git add src/ministries src/app.module.ts src/graphql/schema.gql
git commit -m "feat(ministries): service, resolver, module"
```

---

## Task 2.9: User's `ministries` field

The `User` GraphQL type declares a `ministries: [MinistryMembership!]!` field (see Spec A). We resolve it with a `ResolveField`.

**Files:**
- Create: `src/users/users.field.resolver.ts`
- Modify: `src/users/users.module.ts`

- [ ] **Step 1: Create `src/users/users.field.resolver.ts`**

```ts
import { Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { MinistryMembershipModel } from '../ministries/dto/ministry-membership.model';
import { MinistriesService } from '../ministries/ministries.service';
import { PrismaService } from '../prisma/prisma.service';
import { UserModel } from './dto/user.model';

@Resolver(() => UserModel)
export class UsersFieldResolver {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ministries: MinistriesService,
  ) {}

  @ResolveField(() => [MinistryMembershipModel])
  async ministries(@Parent() user: UserModel): Promise<MinistryMembershipModel[]> {
    const memberships = await this.prisma.ministryMembership.findMany({
      where: { userId: user.id, leftAt: null },
      orderBy: { joinedAt: 'desc' },
    });

    return Promise.all(
      memberships.map(async (m) => ({
        id: m.id,
        role: m.role,
        joinedAt: m.joinedAt,
        leftAt: m.leftAt,
        user,
        ministry: (await this.ministries.findByIdOrThrow(m.ministryId)) as MinistryMembershipModel['ministry'],
      })),
    );
  }
}
```

- [ ] **Step 2: Register in `src/users/users.module.ts`**

Replace file contents:

```ts
import { Module, forwardRef } from '@nestjs/common';
import { MinistriesModule } from '../ministries/ministries.module';
import { UsersFieldResolver } from './users.field.resolver';
import { UsersResolver } from './users.resolver';
import { UsersService } from './users.service';

@Module({
  imports: [forwardRef(() => MinistriesModule)],
  providers: [UsersResolver, UsersFieldResolver, UsersService],
  exports: [UsersService],
})
export class UsersModule {}
```

And adjust `MinistriesModule` to use `forwardRef` for the circular import:

Replace `src/ministries/ministries.module.ts`:

```ts
import { Module, forwardRef } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { MinistriesResolver } from './ministries.resolver';
import { MinistriesService } from './ministries.service';

@Module({
  imports: [forwardRef(() => UsersModule)],
  providers: [MinistriesResolver, MinistriesService],
  exports: [MinistriesService],
})
export class MinistriesModule {}
```

- [ ] **Step 3: Boot and verify schema has `User.ministries`**

Run: `pnpm start` (Ctrl+C after boot).

Check `src/graphql/schema.gql` — `type User` now has `ministries: [MinistryMembership!]!`.

- [ ] **Step 4: Commit**

```bash
git add src/users src/ministries src/graphql/schema.gql
git commit -m "feat(users): resolve user.ministries field"
```

---

## Task 2.10: Seed script — `Acogida` ministry

**Files:**
- Create: `prisma/seed.ts`

- [ ] **Step 1: Create `prisma/seed.ts`**

```ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const acogida = await prisma.ministry.upsert({
    where: { slug: 'acogida' },
    create: {
      slug: 'acogida',
      name: 'Acogida',
      description: 'Ministerio encargado de recibir y registrar nuevos asistentes como prospectos.',
    },
    update: {},
  });
  console.log(`Seed OK: ministerio "${acogida.slug}" (${acogida.id})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

- [ ] **Step 2: Run the seed**

Run: `pnpm prisma:seed`
Expected: "Seed OK: ministerio "acogida" (…)" printed.

- [ ] **Step 3: Re-run to verify idempotency**

Run: `pnpm prisma:seed`
Expected: Same line, no errors, no duplicate rows (upsert).

- [ ] **Step 4: Commit**

```bash
git add prisma/seed.ts
git commit -m "feat(seed): seed Acogida ministry"
```

---

## Task 2.11: `create-pastor` CLI

**Files:**
- Create: `scripts/create-pastor.ts`

- [ ] **Step 1: Create `scripts/create-pastor.ts`**

```ts
import { parseArgs } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

const schema = z.object({
  email: z.string().trim().email().transform((v) => v.toLowerCase()),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
});

async function main() {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      firstName: { type: 'string' },
      lastName: { type: 'string' },
    },
  });

  const input = schema.safeParse(values);
  if (!input.success) {
    console.error('Missing or invalid arguments. Usage:');
    console.error('  pnpm tsx scripts/create-pastor.ts --email jane@x.com --firstName Jane --lastName Doe');
    console.error('Errors:', input.error.issues);
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.upsert({
      where: { email: input.data.email },
      create: {
        ...input.data,
        baseRole: 'MIEMBRO',
        isPastor: true,
      },
      update: {
        firstName: input.data.firstName,
        lastName: input.data.lastName,
        baseRole: 'MIEMBRO',
        isPastor: true,
      },
    });
    console.log(`Pastor ready: ${user.email} (${user.id})`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Test it manually**

Run:
```bash
pnpm tsx scripts/create-pastor.ts --email pastor@alumbra.test --firstName Jose --lastName Prueba
```
Expected: "Pastor ready: pastor@alumbra.test (…)".

- [ ] **Step 3: Run again to verify idempotency**

Same command.
Expected: Same line — upsert doesn't duplicate.

- [ ] **Step 4: Sanity query via GraphQL**

Run: `pnpm dev` in one terminal. In another:

```bash
curl -s -X POST http://localhost:3000/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"{ users(filter: { isPastor: true }) { edges { node { email isPastor baseRole } } } }"}' | jq .
```

Expected:
```json
{
  "data": {
    "users": {
      "edges": [
        { "node": { "email": "pastor@alumbra.test", "isPastor": true, "baseRole": "MIEMBRO" } }
      ]
    }
  }
}
```

Stop `pnpm dev`.

- [ ] **Step 5: Commit**

```bash
git add scripts/create-pastor.ts
git commit -m "feat(scripts): create-pastor CLI for bootstrapping the first pastor"
```

---

## Task 2.12: End-to-end happy-path test

**Files:**
- Modify: `test/app.e2e-spec.ts`

Rewrite the existing E2E to cover the Spec A flow.

- [ ] **Step 1: Replace `test/app.e2e-spec.ts`**

```ts
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';

const gql = (app: INestApplication) => request(app.getHttpServer()).post('/graphql');

describe('Spec A happy path (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    prisma = new PrismaClient();
    await prisma.$connect();
    await prisma.$executeRawUnsafe('DELETE FROM "MinistryMembership"');
    await prisma.$executeRawUnsafe('DELETE FROM "User"');
    await prisma.$executeRawUnsafe('DELETE FROM "Ministry"');
    // Recreate Acogida since we just wiped it
    await prisma.ministry.create({
      data: { slug: 'acogida', name: 'Acogida' },
    });
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe('DELETE FROM "MinistryMembership"');
    await prisma.$executeRawUnsafe('DELETE FROM "User"');
    await prisma.$executeRawUnsafe('DELETE FROM "Ministry"');
    await prisma.$disconnect();
    await app.close();
  });

  it('creates a user, adds to Acogida, filters, removes, soft-deletes', async () => {
    // Fetch Acogida
    const ministryResp = await gql(app)
      .send({ query: '{ ministry(slug: "acogida") { id slug } }' })
      .expect(200);
    const ministryId = ministryResp.body.data.ministry.id;
    expect(ministryResp.body.data.ministry.slug).toBe('acogida');

    // Create a user
    const createResp = await gql(app)
      .send({
        query: `mutation { createUser(input: { email: "e2e@alumbra.test", firstName: "E2E", lastName: "Tester" }) { id email baseRole } }`,
      })
      .expect(200);
    const userId = createResp.body.data.createUser.id;
    expect(createResp.body.data.createUser.email).toBe('e2e@alumbra.test');
    expect(createResp.body.data.createUser.baseRole).toBe('ASISTENTE');

    // Add to Acogida
    const addResp = await gql(app)
      .send({
        query: `mutation AddMember($userId: ID!, $ministryId: ID!) {
          addUserToMinistry(input: { userId: $userId, ministryId: $ministryId, role: MEMBER }) {
            id role user { id } ministry { slug }
          }
        }`,
        variables: { userId, ministryId },
      })
      .expect(200);
    const membershipId = addResp.body.data.addUserToMinistry.id;
    expect(addResp.body.data.addUserToMinistry.ministry.slug).toBe('acogida');

    // Filter users by ministryId
    const filterResp = await gql(app)
      .send({
        query: `query ($mid: String!) {
          users(filter: { ministryId: $mid }) { edges { node { id email } } }
        }`,
        variables: { mid: ministryId },
      })
      .expect(200);
    expect(filterResp.body.data.users.edges).toHaveLength(1);
    expect(filterResp.body.data.users.edges[0].node.id).toBe(userId);

    // Remove membership
    const removeResp = await gql(app)
      .send({
        query: `mutation ($id: ID!) { removeUserFromMinistry(membershipId: $id) { leftAt } }`,
        variables: { id: membershipId },
      })
      .expect(200);
    expect(removeResp.body.data.removeUserFromMinistry.leftAt).not.toBeNull();

    // Filter now excludes the user
    const filterAfterResp = await gql(app)
      .send({
        query: `query ($mid: String!) {
          users(filter: { ministryId: $mid }) { edges { node { id } } }
        }`,
        variables: { mid: ministryId },
      })
      .expect(200);
    expect(filterAfterResp.body.data.users.edges).toHaveLength(0);

    // Soft-delete user
    await gql(app)
      .send({
        query: `mutation ($id: ID!) { softDeleteUser(id: $id) { id } }`,
        variables: { id: userId },
      })
      .expect(200);

    // user() returns null
    const finalResp = await gql(app)
      .send({
        query: `query ($id: ID!) { user(id: $id) { id } }`,
        variables: { id: userId },
      })
      .expect(200);
    expect(finalResp.body.data.user).toBeNull();
  });

  it('rejects duplicate addUserToMinistry', async () => {
    const ministry = await prisma.ministry.findUniqueOrThrow({ where: { slug: 'acogida' } });
    const createResp = await gql(app)
      .send({
        query: `mutation { createUser(input: { email: "dup@alumbra.test", firstName: "D", lastName: "U" }) { id } }`,
      })
      .expect(200);
    const userId = createResp.body.data.createUser.id;

    await gql(app)
      .send({
        query: `mutation ($u: ID!, $m: ID!) { addUserToMinistry(input: { userId: $u, ministryId: $m, role: MEMBER }) { id } }`,
        variables: { u: userId, m: ministry.id },
      })
      .expect(200);

    const dup = await gql(app)
      .send({
        query: `mutation ($u: ID!, $m: ID!) { addUserToMinistry(input: { userId: $u, ministryId: $m, role: MEMBER }) { id } }`,
        variables: { u: userId, m: ministry.id },
      })
      .expect(200);
    expect(dup.body.errors?.[0]?.message).toMatch(/active membership/i);
  });

  it('rejects creating a ministry with a duplicate slug', async () => {
    const resp = await gql(app)
      .send({
        query: `mutation { createMinistry(input: { slug: "acogida", name: "Duplicate" }) { id } }`,
      })
      .expect(200);
    expect(resp.body.errors?.[0]?.message).toMatch(/slug/i);
  });
});
```

- [ ] **Step 2: Run the E2E suite**

Run: `pnpm test:e2e`
Expected: PASS (3 tests). All DB cleanup happens inside the test.

- [ ] **Step 3: Commit**

```bash
git add test/app.e2e-spec.ts
git commit -m "test(e2e): spec A happy path, duplicate membership, duplicate slug"
```

---

## Task 2.13: Full verification

- [ ] **Step 1: Lint**

Run: `pnpm lint`
Expected: no errors. Fix any warnings you introduced in this phase (don't touch unrelated code).

- [ ] **Step 2: Unit tests**

Run: `pnpm test`
Expected: all pass.

- [ ] **Step 3: E2E tests**

Run: `pnpm test:e2e`
Expected: all pass.

- [ ] **Step 4: Build**

Run: `pnpm build`
Expected: compiles without errors.

- [ ] **Step 5: Manual smoke via Apollo Sandbox**

Run: `pnpm dev`. In a browser, go to `http://localhost:3000/graphql`. Run:

```graphql
query { ministry(slug: "acogida") { id name } }
mutation { createUser(input: { email: "manual@x.com", firstName: "Manual", lastName: "Smoke" }) { id fullName } }
query { users { edges { node { email fullName baseRole isPastor } } pageInfo { hasNextPage } } }
```

All should succeed. Stop the server.

- [ ] **Step 6: Update Phase 2 section in README (if needed)**

Ensure the README already mentions the `create-pastor` script (added in Task 1.8) and the seed step. If not, add it.

- [ ] **Step 7: Final commit if anything changed in Step 6**

```bash
git add README.md
git commit -m "docs: tidy README with Spec A usage notes"
```

(If nothing changed, skip.)

---

# Close-out

When Phase 1 and Phase 2 verifications all pass:
- Phase 1 satisfies `docs/superpowers/specs/2026-04-21-backend-scaffold-design.md`.
- Phase 2 satisfies `docs/superpowers/specs/2026-04-21-spec-a-users-roles-ministries-design.md` **except for the `me: User` dev-only query**, which is intentionally deferred to the auth session — `user(id)` covers the same dev need, and wiring `me` properly only makes sense once the auth context/request header plumbing exists.

Next specs (B: membership pipeline; C: grupos + cursos) go in their own brainstorm/plan cycles.
