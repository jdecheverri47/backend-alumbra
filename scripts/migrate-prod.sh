#!/usr/bin/env bash
#
# Aplica las migraciones de Prisma contra la base de datos de producción.
#
# Levanta cloud-sql-proxy en un puerto local, corre `prisma migrate deploy` y
# cierra el proxy. Se hace desde aquí y no al arrancar el contenedor a propósito:
# si Cloud Run escala a varias instancias, todas correrían las migraciones a la
# vez y compiten por el lock de Prisma.
#
# Corre esto ANTES de ./scripts/deploy.sh cuando el cambio toca el esquema.
#
# Uso:
#   ./scripts/migrate-prod.sh
#
# Requiere:
#   - cloud-sql-proxy en el PATH (https://github.com/GoogleCloudPlatform/cloud-sql-proxy)
#   - gcloud con sesión iniciada y permiso Cloud SQL Client
#   - DB_PASSWORD exportada, o el script la lee de Secret Manager

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-alumbra-504117}"
REGION="${REGION:-us-east1}"
SQL_INSTANCE="${SQL_INSTANCE:-alumbra-pg}"
DB_USER="${DB_USER:-alumbra}"
DB_NAME="${DB_NAME:-alumbra}"
PROXY_PORT="${PROXY_PORT:-5433}" # 5433 para no chocar con el Postgres local de dev

SQL_CONNECTION_NAME="${PROJECT_ID}:${REGION}:${SQL_INSTANCE}"

command -v cloud-sql-proxy >/dev/null 2>&1 || {
  echo "error: falta cloud-sql-proxy." >&2
  echo "  brew install cloud-sql-proxy" >&2
  exit 1
}

# La contraseña sale de Secret Manager salvo que ya venga en el entorno.
if [[ -z "${DB_PASSWORD:-}" ]]; then
  echo "==> Leyendo la contraseña desde Secret Manager"
  DB_PASSWORD="$(gcloud secrets versions access latest \
    --secret alumbra-db-password \
    --project "${PROJECT_ID}")"
fi

# Si otro Postgres ya escucha en ese puerto, el chequeo de abajo lo daría por el
# proxy y Prisma terminaría hablando con la base equivocada.
if nc -z localhost "${PROXY_PORT}" 2>/dev/null; then
  echo "error: localhost:${PROXY_PORT} ya está ocupado. Usa otro: PROXY_PORT=5439 $0" >&2
  exit 1
fi

echo "==> Abriendo cloud-sql-proxy en localhost:${PROXY_PORT} → ${SQL_CONNECTION_NAME}"
# --gcloud-auth usa la cuenta de la configuración de gcloud (la de Alumbra) en
# vez de las Application Default Credentials, que son globales a la máquina.
cloud-sql-proxy "${SQL_CONNECTION_NAME}" --port "${PROXY_PORT}" --gcloud-auth &
PROXY_PID=$!

# Cierra el proxy pase lo que pase.
cleanup() {
  echo "==> Cerrando cloud-sql-proxy"
  kill "${PROXY_PID}" 2>/dev/null || true
  wait "${PROXY_PID}" 2>/dev/null || true
}
trap cleanup EXIT

# Espera a que el proxy acepte conexiones.
for _ in $(seq 1 30); do
  if nc -z localhost "${PROXY_PORT}" 2>/dev/null; then break; fi
  sleep 0.5
done

nc -z localhost "${PROXY_PORT}" 2>/dev/null || {
  echo "error: el proxy no respondió en localhost:${PROXY_PORT}" >&2
  exit 1
}

# La contraseña va url-encoded por si trae caracteres especiales.
DB_PASSWORD_ENC="$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "${DB_PASSWORD}")"
export DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD_ENC}@localhost:${PROXY_PORT}/${DB_NAME}?schema=public"

echo "==> prisma migrate deploy"
pnpm prisma migrate deploy

echo "==> Migraciones aplicadas."
