# Migración del Instituto Bíblico desde Google Classroom

El primer paso es **exportar** lo que hay en Classroom a archivos JSON locales,
en modo solo lectura, para ver el tamaño y la estructura real antes de diseñar
el módulo en Alumbra. El script es `scripts/classroom-export.ts`.

## Una sola vez: preparar el proyecto de GCP (`alumbra-504117`)

1. **APIs**: activar Google Classroom API y Google Drive API.

   ```bash
   CLOUDSDK_ACTIVE_CONFIG_NAME=alumbra gcloud services enable \
     classroom.googleapis.com drive.googleapis.com --project alumbra-504117
   ```

2. **Público de la app** (Google Auth Platform → Público / *Audience*):
   - Si es **Interno**, solo pueden entrar cuentas `@iglesiaalumbra.org`.
   - Si es **Externo** y está en **Prueba**, hay que agregar la cuenta de
     Classroom en *Usuarios de prueba*.

3. **Cliente OAuth de escritorio** (Google Auth Platform → Clientes → Crear
   cliente):
   - Tipo de aplicación: **App de escritorio**.
   - Nombre: `Alumbra – migración Classroom`.
   - **Descargar JSON** y guardarlo como `classroom-credentials.json` en la raíz
     de `backend-alumbra/`. Está en `.gitignore`: no se commitea.

## Exportar

```bash
pnpm classroom:export
```

Abre el navegador: hay que entrar con la **cuenta dueña o profesora** de las
clases y aceptar los permisos, todos de solo lectura. Como la app no está
verificada por Google, aparece la advertencia "Google no verificó esta app":
*Configuración avanzada → Ir a Alumbra*.

Queda todo en `classroom-export/` (también en `.gitignore`, porque tiene datos
personales de los alumnos):

```
classroom-export/
  summary.json            resumen por clase y tamaño de los archivos de Drive
  drive-files.json        ficha de cada adjunto (nombre, tipo, tamaño, dueño)
  <clase>-<id>/
    course.json  topics.json  coursework.json  materials.json
    announcements.json  students.json  teachers.json  submissions.json
    errors.json           lo que no se pudo leer (p. ej. por permisos)
```

Los adjuntos de Drive todavía no se descargan: con `summary.json` se decide si
se copian al bucket de GCS o se dejan como enlaces.

## Bajar los adjuntos

```bash
pnpm classroom:export --download
```

Pide además permiso de lectura de Drive y baja a `classroom-export/files/` todo
lo que no es video (los videos quedan como enlace a Drive).

## Importar al Instituto Bíblico

`scripts/classroom-import.ts` crea módulos (temas), publicaciones (materiales,
tareas y exámenes), inscripciones y entregas con sus notas. Es repetible: cada
registro guarda su id de Classroom. Sin `--apply` es solo vista previa.

```bash
pnpm classroom:import            # vista previa contra la base local
pnpm classroom:import --apply    # local; los archivos van a ./uploads
```

En producción, con el proxy de Cloud SQL abierto (ver `scripts/migrate-prod.sh`)
y los archivos al bucket:

```bash
DATABASE_URL="postgresql://…@127.0.0.1:5439/alumbra" \
  pnpm classroom:import --apply --files gcs
```

- Las personas se buscan por correo. Quien no tenga cuenta se crea como
  asistente con acceso para entrar con Google; a nadie se le cambia el tipo.
- Los exámenes de Google Forms quedan como enlace al formulario (`/viewform`).
- Las notas que en Classroom quedaron en borrador siguen en borrador: el
  profesor las devuelve desde la tarea ("Devolver N notas en borrador").
