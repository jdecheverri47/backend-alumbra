# syntax=docker/dockerfile:1

# Imagen de producción del backend de Alumbra (NestJS + Prisma).
# Se construye en Cloud Build vía `gcloud run deploy --source .` (ver scripts/deploy.sh).

FROM node:22-alpine AS base
# Prisma 5 necesita openssl en Alpine para el query engine.
RUN apk add --no-cache openssl
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# ---------------------------------------------------------------------------
# Build: dependencias completas, cliente de Prisma y compilación de TypeScript.
# ---------------------------------------------------------------------------
FROM base AS build

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# El cliente de Prisma se genera antes del build porque el código lo importa.
COPY prisma ./prisma
RUN pnpm prisma generate

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN pnpm build

# Deja solo dependencias de producción. El cliente generado vive bajo
# @prisma/client (que es dependencia de producción), así que sobrevive al prune.
RUN pnpm prune --prod

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM base AS runtime

ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package.json ./

# UPLOAD_DIR por defecto es <cwd>/uploads. En Cloud Run el filesystem es
# efímero y por instancia: esto sirve para arrancar, NO para conservar archivos.
# Ver docs/deploy-gcp.md § Archivos subidos.
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads

USER node

# Cloud Run inyecta PORT (8080) y la app lo lee desde ConfigService.
# No declares PORT como variable de entorno en el deploy: Cloud Run lo reserva.
EXPOSE 8080

CMD ["node", "dist/main"]
