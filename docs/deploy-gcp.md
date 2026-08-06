# Despliegue en GCP (Cloud Run + Cloud SQL)

El backend es un servidor NestJS de larga vida (`src/main.ts` hace `app.listen`),
no una función. El destino es **Cloud Run**: un contenedor, con la base en
**Cloud SQL** y los secretos en **Secret Manager**.

No hay Pulumi ni Terraform a propósito: la infra son cuatro recursos y se crean
una sola vez con los comandos de abajo. Cuando aparezca un segundo entorno
(staging) o alguien más toque la consola, ahí sí conviene pasarlo a IaC.

| Pieza | Qué es |
| --- | --- |
| `Dockerfile` | Imagen de producción, multi-stage (build + runtime). |
| `scripts/deploy.sh` | Build en Cloud Build + deploy a Cloud Run. Se corre en cada despliegue. |
| `scripts/migrate-prod.sh` | `prisma migrate deploy` contra Cloud SQL vía proxy. Solo si cambió el esquema. |

---

## 1. Setup inicial (una sola vez)

Alumbra vive en su propia cuenta (`it@iglesiaalumbra.org`), aparte de las otras
cuentas de gcloud de la máquina. Está amarrada a una configuración propia, así
que basta con activarla para cambiar cuenta y proyecto a la vez:

```bash
gcloud config configurations activate alumbra
```

> Al crear una configuración nueva, créala **antes** de correr `gcloud auth login`.
> El login escribe la cuenta en la configuración que esté activa en ese momento,
> así que hacerlo al revés le mete la cuenta nueva a la configuración anterior.

Ajusta estas variables y pégalas en la terminal; los comandos siguientes las usan.

```bash
export PROJECT_ID=alumbra-504117   # el ID lleva sufijo; "alumbra" es solo el nombre
export REGION=us-east1             # Carolina del Sur: el tráfico desde Colombia sale por Miami
export SQL_INSTANCE=alumbra-pg
export DB_USER=alumbra
export DB_NAME=alumbra
```

### 1.1 Habilitar APIs

```bash
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  secretmanager.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  --project "$PROJECT_ID"
```

### 1.2 Cloud SQL (PostgreSQL 16)

Precios reales del catálogo de facturación de Google (SKU zonal, Américas):

| Tier | Por hora | Al mes (730 h) | Con 10 GB SSD |
| --- | --- | --- | --- |
| `db-f1-micro` | $0.0105 | $7.67 | **~$9.40** |
| `db-g1-small` | $0.0350 | $25.55 | ~$27.25 |

Empezamos en `db-f1-micro`. **Subir de tier no requiere recrear ni migrar nada**,
es un cambio de máquina con un reinicio de pocos minutos:

```bash
gcloud sql instances patch alumbra-pg --tier db-g1-small --project "$PROJECT_ID"
```

Ninguno de los dos está cubierto por el SLA de Cloud SQL (son de núcleo
compartido); para eso hace falta núcleo dedicado, que es otro rango de precio.

```bash
gcloud sql instances create "$SQL_INSTANCE" \
  --project "$PROJECT_ID" \
  --database-version POSTGRES_16 \
  --region "$REGION" \
  --tier db-f1-micro \
  --storage-size 10GB \
  --storage-auto-increase

# Contraseña del usuario de aplicación
export DB_PASSWORD="$(openssl rand -base64 32)"

gcloud sql databases create "$DB_NAME" --instance "$SQL_INSTANCE" --project "$PROJECT_ID"
gcloud sql users create "$DB_USER" \
  --instance "$SQL_INSTANCE" \
  --password "$DB_PASSWORD" \
  --project "$PROJECT_ID"
```

### 1.3 Secretos

Cloud Run se conecta a Cloud SQL por **socket unix**, no por TCP: de ahí el
parámetro `host=/cloudsql/...` en la URL.

```bash
CONN="${PROJECT_ID}:${REGION}:${SQL_INSTANCE}"

# Contraseña suelta (la usa scripts/migrate-prod.sh)
printf '%s' "$DB_PASSWORD" | gcloud secrets create alumbra-db-password \
  --data-file=- --project "$PROJECT_ID"

# DATABASE_URL completa que consume la app
printf '%s' "postgresql://${DB_USER}:${DB_PASSWORD}@localhost/${DB_NAME}?host=/cloudsql/${CONN}&schema=public&connection_limit=3" \
  | gcloud secrets create alumbra-database-url --data-file=- --project "$PROJECT_ID"

# JWT_SECRET (el env schema exige 32+ caracteres)
openssl rand -base64 48 | tr -d '\n' \
  | gcloud secrets create alumbra-jwt-secret --data-file=- --project "$PROJECT_ID"
```

> Si `DB_PASSWORD` trae `@`, `/` o `#`, url-encódala antes de meterla en
> `alumbra-database-url`. La generada con `openssl rand -base64 32` puede traer
> `/` y `+`: lo más simple es regenerarla con `openssl rand -hex 32`.

**Por qué `connection_limit=3`.** Cada instancia de Cloud Run abre su propio pool
de Prisma, y por defecto Prisma pide `núcleos × 2 + 1` conexiones. `db-f1-micro`
admite pocas decenas en total, así que sin límite un pico de tráfico agota el
cupo y la app responde `too many connections`. Con `connection_limit=3` y
`--max-instances 3` (lo que fija `deploy.sh`) el techo son 9 conexiones, que
entra de sobra. Si algún día subes `--max-instances`, sube también el tier.

### 1.4 Service account y permisos

```bash
gcloud iam service-accounts create backend-alumbra \
  --display-name "Backend Alumbra (Cloud Run)" \
  --project "$PROJECT_ID"

SA="backend-alumbra@${PROJECT_ID}.iam.gserviceaccount.com"

# Conectarse a Cloud SQL
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member "serviceAccount:${SA}" \
  --role roles/cloudsql.client

# Leer los dos secretos que monta el servicio
for s in alumbra-database-url alumbra-jwt-secret; do
  gcloud secrets add-iam-policy-binding "$s" \
    --member "serviceAccount:${SA}" \
    --role roles/secretmanager.secretAccessor \
    --project "$PROJECT_ID"
done
```

---

## 2. Desplegar

```bash
./scripts/migrate-prod.sh   # solo si hay migraciones nuevas
./scripts/deploy.sh
```

`deploy.sh` usa `gcloud run deploy --source .`, así que Cloud Build construye
con el `Dockerfile` del repo y sube la imagen a Artifact Registry (crea el
repositorio solo la primera vez). Los valores por defecto del script están al
principio del archivo y se sobreescriben por entorno:

```bash
CORS_ORIGIN=https://staging.iglesiaalumbra.org REGION=us-east1 ./scripts/deploy.sh
```

Las migraciones **no** corren al arrancar el contenedor a propósito: si Cloud Run
levanta varias instancias a la vez, todas competirían por el lock de Prisma.

---

## 3. Cosas que hay que saber

### Archivos subidos (pendiente real)

`src/uploads/uploads.controller.ts:44` guarda los archivos con `diskStorage` en
el disco local y `ServeStaticModule` los sirve desde ahí. **En Cloud Run ese
filesystem es efímero y por instancia**: lo que se suba desaparece en el
siguiente despliegue y no se comparte entre instancias.

La imagen crea `/app/uploads` para que la app arranque, pero eso solo sirve para
probar. Antes de que entren usuarios reales hay que migrar el almacenamiento a
un bucket de Cloud Storage.

### Cookies entre dominios

`src/auth/auth.controller.ts:90` marca la cookie de refresh como
`secure` en producción con `sameSite: 'lax'`. Eso implica que **frontend y
backend deben compartir el dominio registrable**. El plan es:

| Host | Qué sirve |
| --- | --- |
| `iglesiaalumbra.org` + `www.iglesiaalumbra.org` | Frontend |
| `api.iglesiaalumbra.org` | Este backend (dominio propio sobre Cloud Run) |

Los tres cuelgan de `iglesiaalumbra.org`, así que son same-site y la cookie
viaja con `sameSite: 'lax'`. Por eso `COOKIE_DOMAIN=.iglesiaalumbra.org` (con
punto inicial: vale para el apex y para cualquier subdominio).

Si el back se queda en `*.run.app` y el front en `iglesiaalumbra.org` son sitios
distintos, el navegador no manda la cookie y el refresh falla en silencio. Es
decir: **mapear el dominio propio a Cloud Run no es opcional**, es parte de que
el login funcione. Alternativa si no se puede: cambiar la cookie a
`sameSite: 'none'` en `src/auth/auth.controller.ts:91`.

Apex y `www` son orígenes **distintos** para el navegador, por eso `CORS_ORIGIN`
lleva los dos separados por coma. Como `gcloud --set-env-vars` también separa por
comas, `deploy.sh` usa el delimitador alterno `^##^` para pasarlos sin romper el
parseo. Si rediriges `www` al apex en el DNS, puedes dejar solo el apex.

### Rate limiting

`ThrottlerModule` (`src/app.module.ts:51`) guarda el contador en memoria, así que
el límite es por instancia. Con `--max-instances 3` el límite efectivo es hasta
3× el configurado. Aceptable al principio; si importa, hay que moverlo a Redis.

### PORT

Cloud Run inyecta `PORT=8080` y reserva la variable: no la declares en el deploy.
La app ya la lee vía `ConfigService` (`src/main.ts:15`).

---

## 4. Problemas comunes

**`PERMISSION_DENIED` en el build.** En proyectos nuevos Cloud Build usa la
service account de Compute por defecto y suele faltarle permiso:

```bash
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format 'value(projectNumber)')"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member "serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role roles/cloudbuild.builds.builder
```

**El contenedor no arranca / falla el health check.** Casi siempre es el env
schema (`src/config/env.schema.ts`) rechazando algo: `DATABASE_URL` mal formada o
`JWT_SECRET` de menos de 32 caracteres. El error sale entero en los logs:

```bash
gcloud run services logs read backend-alumbra --region "$REGION" --limit 50
```

**`Can't reach database server`.** Falta `--add-cloudsql-instances` en el deploy
(lo pone `deploy.sh`) o a la service account le falta `roles/cloudsql.client`.
