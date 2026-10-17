#!/usr/bin/env bash
#
# Despliega el backend de Alumbra a Cloud Run.
#
# Construye la imagen con Cloud Build (usando el Dockerfile del repo) y la
# publica en el servicio de Cloud Run, conectada a Cloud SQL por socket unix.
#
# Los pasos que se hacen UNA sola vez (crear la instancia de Cloud SQL, los
# secretos, la service account) están en docs/deploy-gcp.md. Este script asume
# que ya existen.
#
# Uso:
#   ./scripts/deploy.sh
#   PROJECT_ID=otro-proyecto REGION=us-east1 ./scripts/deploy.sh
#
# Antes de desplegar un cambio de esquema, corre ./scripts/migrate-prod.sh.

set -euo pipefail

# --- Configuración (sobreescribible por entorno) ----------------------------
PROJECT_ID="${PROJECT_ID:-alumbra-504117}"
REGION="${REGION:-us-east1}"
SERVICE="${SERVICE:-backend-alumbra}"
SQL_INSTANCE="${SQL_INSTANCE:-alumbra-pg}"
SERVICE_ACCOUNT="${SERVICE_ACCOUNT:-backend-alumbra@${PROJECT_ID}.iam.gserviceaccount.com}"

# Secretos en Secret Manager (nombre:versión).
SECRET_DATABASE_URL="${SECRET_DATABASE_URL:-alumbra-database-url:latest}"
SECRET_JWT="${SECRET_JWT:-alumbra-jwt-secret:latest}"

# Variables de entorno de la app. CORS_ORIGIN son los orígenes exactos del
# frontend (con esquema, sin barra final) o el login por cookie no funciona.
# Van el apex y www porque para el navegador son orígenes distintos.
CORS_ORIGIN="${CORS_ORIGIN:-https://iglesiaalumbra.org,https://www.iglesiaalumbra.org}"
COOKIE_DOMAIN="${COOKIE_DOMAIN:-.iglesiaalumbra.org}"
JWT_ACCESS_TTL="${JWT_ACCESS_TTL:-15m}"
REFRESH_TTL_DAYS="${REFRESH_TTL_DAYS:-30}"
# OAuth Client ID (web) para "Continuar con Google". No es secreto: el frontend
# lo publica igual. Es el cliente "Alumbra web" del proyecto alumbra-504117.
GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-1022563906083-rjdnim29f3i09lu34tnufrc9ii3u4bec.apps.googleusercontent.com}"
# Bucket privado de los archivos subidos (fotos, videos, documentos). El disco
# de Cloud Run se borra en cada despliegue, así que sin bucket se pierden.
GCS_BUCKET="${GCS_BUCKET:-alumbra-504117-uploads}"
# Trabajo de Cloud Run que pasa a HLS los videos que se publican (misma imagen
# que la API, con más CPU y memoria). La API lo lanza con el nombre del video.
VIDEO_JOB_NAME="${VIDEO_JOB_NAME:-video-hls}"
VIDEO_JOB="projects/${PROJECT_ID}/locations/${REGION}/jobs/${VIDEO_JOB_NAME}"

# --- Comprobaciones ---------------------------------------------------------
command -v gcloud >/dev/null 2>&1 || {
  echo "error: falta gcloud. Instala el SDK: https://cloud.google.com/sdk/docs/install" >&2
  exit 1
}

gcloud auth print-access-token >/dev/null 2>&1 || {
  echo "error: no hay sesión de gcloud. Corre: gcloud auth login" >&2
  exit 1
}

SQL_CONNECTION_NAME="${PROJECT_ID}:${REGION}:${SQL_INSTANCE}"

echo "==> Desplegando ${SERVICE}"
echo "    proyecto : ${PROJECT_ID}"
echo "    región   : ${REGION}"
echo "    Cloud SQL: ${SQL_CONNECTION_NAME}"
echo "    CORS     : ${CORS_ORIGIN}"
echo "    Archivos : gs://${GCS_BUCKET}"
echo

# --- Deploy -----------------------------------------------------------------
# --source . hace que Cloud Build use el Dockerfile del repo y suba la imagen a
# Artifact Registry (crea el repositorio automáticamente la primera vez).
#
# Nota: no se declara PORT — Cloud Run lo inyecta (8080) y lo reserva.
#
# --no-invoker-iam-check en vez de --allow-unauthenticated: la organización de
# iglesiaalumbra.org tiene Domain Restricted Sharing, que prohíbe dar el rol de
# invoker a allUsers. Esto deja el servicio público sin pasar por IAM.
gcloud run deploy "${SERVICE}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --source . \
  --platform managed \
  --service-account "${SERVICE_ACCOUNT}" \
  --add-cloudsql-instances "${SQL_CONNECTION_NAME}" \
  --set-secrets "DATABASE_URL=${SECRET_DATABASE_URL},JWT_SECRET=${SECRET_JWT}" \
  --set-env-vars "^##^NODE_ENV=production##CORS_ORIGIN=${CORS_ORIGIN}##COOKIE_DOMAIN=${COOKIE_DOMAIN}##JWT_ACCESS_TTL=${JWT_ACCESS_TTL}##REFRESH_TTL_DAYS=${REFRESH_TTL_DAYS}##GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}##GCS_BUCKET=${GCS_BUCKET}##VIDEO_JOB=${VIDEO_JOB}" \
  --no-invoker-iam-check \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 3 \
  --timeout 60s

# --- Trabajo video-hls ----------------------------------------------------
# Con la imagen recién publicada: el código del trabajo es el de esta versión.
IMAGE="$(gcloud run services describe "${SERVICE}" \
  --project "${PROJECT_ID}" --region "${REGION}" \
  --format 'value(spec.template.spec.containers[0].image)')"

echo
echo "==> Actualizando el trabajo ${VIDEO_JOB_NAME} (${IMAGE})"
gcloud run jobs deploy "${VIDEO_JOB_NAME}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --image "${IMAGE}" \
  --service-account "${SERVICE_ACCOUNT}" \
  --set-cloudsql-instances "${SQL_CONNECTION_NAME}" \
  --set-secrets "DATABASE_URL=${SECRET_DATABASE_URL}" \
  --set-env-vars "NODE_ENV=production,GCS_BUCKET=${GCS_BUCKET}" \
  --command node \
  --args dist/media/hls-job.js \
  --cpu 2 \
  --memory 4Gi \
  --task-timeout 3600 \
  --max-retries 1

echo
echo "==> Listo. URL del servicio:"
gcloud run services describe "${SERVICE}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --format 'value(status.url)'
