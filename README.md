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

## Crear el primer pastor

Una vez aplicadas las migraciones de Spec A:

```bash
pnpm tsx scripts/create-pastor.ts --email jane@example.com --firstName Jane --lastName Doe
```

## Spec docs

- Scaffold: `docs/superpowers/specs/2026-04-21-backend-scaffold-design.md`
- Spec A (users/roles/ministries): `docs/superpowers/specs/2026-04-21-spec-a-users-roles-ministries-design.md`
