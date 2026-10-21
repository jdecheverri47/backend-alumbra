# Spec E — Inscripción al Instituto por solicitud y notificaciones

**Fecha:** 2026-10-20
**Estado:** Borrador, para revisión. Las decisiones se tomaron con Jose en la sesión.
**Depende de:** Instituto Bíblico (`InstituteEnrollment`), Permisos IAM (`catalog.ts`), solicitudes de acceso (`AccessRequest`).

## Contexto

- Hoy a alguien lo inscribe al Instituto quien tenga `instituto.administrar` (`InstituteService.enroll`). Nadie puede pedirlo por su cuenta.
- El menú solo muestra "Instituto Bíblico" a alumnos, profesores y pastores (`app-shell.tsx:91`). Quien no está inscrito ni sabe que el Instituto existe.
- No hay notificaciones de ningún tipo: ni modelo, ni correo, ni campana.

## Parte 1 — Solicitar inscripción al Instituto

### Quién la pide

Un **asistente o miembro que ya tiene sesión iniciada** (`canSignIn`) y no está inscrito. El Instituto no tiene una página pública; las cuentas nuevas siguen pasando primero por `AccessRequest`.

### Cómo llega

**Menú con candado.** A todos los usuarios con sesión les sale "Instituto Bíblico" en el menú, con un candado si no están inscritos. Quien no está inscrito ve solo una portada (qué es el Instituto y cómo funciona) y el botón **Solicitar inscripción**. No ve módulos, materiales, clases ni notas: el backend sigue negando esas consultas como hasta ahora.

Estados de la portada:

| Estado | Lo que ve |
|---|---|
| Sin solicitud | Botón "Solicitar inscripción" + nota opcional |
| `PENDING` | "Tu solicitud está en revisión" + botón para cancelarla |
| `REJECTED` hace menos de 30 días | "No fue aprobada" + motivo (si lo hay) + fecha desde la que puede volver a pedirla |
| `REJECTED` hace 30 días o más | Igual que "sin solicitud" |
| Inscrito | El Instituto normal |

### Modelo

```prisma
enum InstituteRequestStatus {
  PENDING
  APPROVED
  REJECTED
  CANCELLED
}

model InstituteEnrollmentRequest {
  id           String                 @id @default(cuid())
  userId       String
  note         String?                // "¿por qué quieres entrar?" (opcional, máx. 500)
  status       InstituteRequestStatus @default(PENDING)
  reviewedById String?
  reviewedAt   DateTime?
  reviewNote   String?                // motivo del rechazo, se le muestra a la persona
  createdAt    DateTime               @default(now())
  updatedAt    DateTime               @updatedAt

  user       User  @relation("InstituteRequestUser", fields: [userId], references: [id])
  reviewedBy User? @relation("InstituteRequestReviewer", fields: [reviewedById], references: [id])

  @@index([status])
  @@index([userId, createdAt])
}
```

Se guarda el historial completo; nada se sobreescribe. Cada persona puede tener **una sola solicitud `PENDING`**. Se comprueba en el servicio, dentro de una transacción, y se refuerza con un índice único parcial en la migración SQL: `WHERE status = 'PENDING'`.

### Permiso

Nuevo permiso en el grupo `instituto` de `catalog.ts`:

```ts
{
  key: 'instituto.inscripciones',
  label: 'Aprobar inscripciones',
  description: 'Ver, aprobar o rechazar las solicitudes para entrar al Instituto.',
  scopes: ['CHURCH'],
}
```

Se agrega al rol predefinido `director-instituto`. Los pastores lo tienen siempre, como con todos los permisos. Se puede otorgar a cualquier persona desde la pantalla de Permisos.

### API (GraphQL)

| Operación | Quién | Qué hace |
|---|---|---|
| `myInstituteRequest` | cualquiera con sesión | Su última solicitud y `canRequestAgainAt` |
| `requestInstituteEnrollment(note)` | no inscrito, sin solicitud pendiente, sin rechazo de los últimos 30 días | Crea la solicitud; avisa a los revisores |
| `cancelInstituteRequest` | el propio solicitante | `PENDING` → `CANCELLED` |
| `instituteRequests(status)` | `instituto.inscripciones` | Lista con nombre, foto, `baseRole`, grupos, ministerios y nota |
| `approveInstituteRequest(id)` | `instituto.inscripciones` | En una transacción: `upsert` de `InstituteEnrollment` (rol `STUDENT`; si tenía `leftAt`, se reactiva) y solicitud → `APPROVED`. Avisa al solicitante |
| `rejectInstituteRequest(id, reviewNote?)` | `instituto.inscripciones` | → `REJECTED`. Avisa al solicitante con el motivo |

Si un coordinador inscribe a mano a alguien que tenía una solicitud pendiente, esa solicitud pasa a `APPROVED` en la misma transacción.

`instituteAccess` devuelve también `canReviewRequests` y `pendingRequests` (el número), para el contador del menú.

### Frontend

- `app-shell.tsx`: "Instituto Bíblico" se muestra a todos, con candado si `role === null && !manage`. Para los revisores, junto al ítem va un contador de solicitudes pendientes.
- `/instituto` sin inscripción: la portada con los estados de la tabla de arriba.
- `/instituto/solicitudes` (o una pestaña en "Alumnos"): la lista con Aprobar / Rechazar. Rechazar abre un diálogo con un motivo opcional.

## Parte 2 — Notificaciones

### Canales

1. **Campana en la app**: recibe todos los avisos.
2. **Correo**, con **Resend**: solo los avisos importantes, y cada persona puede apagarlos por tipo.

### Modelo

```prisma
model Notification {
  id        String    @id @default(cuid())
  userId    String
  type      String    // clave del catálogo, p. ej. 'instituto.solicitud.nueva'
  title     String
  body      String?
  href      String?   // a dónde lleva al hacer clic, p. ej. '/instituto/solicitudes'
  actorId   String?   // quién la provocó
  data      Json?
  readAt    DateTime?
  emailedAt DateTime?
  createdAt DateTime  @default(now())

  user  User  @relation("NotificationUser", fields: [userId], references: [id])
  actor User? @relation("NotificationActor", fields: [actorId], references: [id])

  @@index([userId, readAt, createdAt])
}

model NotificationPreference {
  userId String
  type   String
  email  Boolean   // la campana no se puede apagar

  user User @relation(fields: [userId], references: [id])

  @@id([userId, type])
}
```

Si no hay fila de preferencia, rige el valor por defecto del catálogo.

### Servicio

`NotificationsModule` con `NotificationsService.notify({ type, recipients, title, body, href, actorId, data })`:

- Crea una fila por destinatario (`createMany`) y nunca le avisa al propio actor.
- Si el tipo va por correo y la persona no lo apagó, encola el envío.
- Los demás módulos lo llaman **después** de confirmar su transacción. Si el aviso falla, se registra en el log y no se revierte la acción.
- `recipientsWithPermission(key, scope?)` resuelve "quién tiene el permiso X" con `PermissionsService`. Así se encuentran los revisores y los coordinadores.

### Catálogo de avisos (v1)

`email` = valor por defecto del correo. Lo que tiene `email: false` llega solo a la campana.

| Tipo | Para quién | Cuándo | Correo |
|---|---|---|---|
| `acceso.solicitud.nueva` | quien aprueba accesos | `AccessRequest` creada | sí |
| `acceso.solicitud.aprobada` | el solicitante | aprobada | sí (es su bienvenida, todavía no usa la campana) |
| `instituto.solicitud.nueva` | `instituto.inscripciones` | solicitud creada | sí |
| `instituto.solicitud.respondida` | el solicitante | aprobada o rechazada | sí |
| `instituto.contenido.nuevo` | alumnos | `saveItem` publica material o tarea nueva | no |
| `instituto.fecha.proxima` | alumnos sin entregar | 24 h antes de la fecha límite | sí |
| `instituto.nota.publicada` | el alumno | `grade` / `importFormGrades` | sí |
| `instituto.clase.proxima` | alumnos y profesores | 24 h antes de una `InstituteClass` | no |
| `muro.anuncio.nuevo` | quien puede verlo | `createPost` de tipo `ANUNCIO` | no |
| `muro.comentario` | el autor del post | `addComment` | no |
| `calendario.evento.proximo` | quien puede verlo | 24 h antes de un evento | no |
| `acogida.asignacion` | el responsable | `assign` / `assignMany` | sí |
| `ruta.etapa` | el candidato | cambio de etapa (`validate`, `assignToRuta`, `openChurchFilter`, pacto…) | sí |
| `ruta.asignacion` | el líder | `assignToLeader` | sí |

Las reacciones a un post **no** generan aviso: harían demasiado ruido. `assignMany` y `importFormGrades` mandan **un solo** aviso por destinatario, con el conteo ("Te asignaron 5 registros").

**Rechazo del acceso a la app:** no se avisa. La persona no tiene cuenta para ver la campana, y un correo de rechazo a alguien que acaba de llegar a la iglesia se siente frío. Confirmado por Jose el 2026-10-20.

### Recordatorios (los de "24 h antes")

Un endpoint interno `POST /internal/notifications/tick`, protegido con un token, que **Cloud Scheduler** llama cada 15 min. Busca fechas límite, clases y eventos que caigan entre 24 h y 24 h + 15 min, y avisa a quien corresponda. Para no repetir: antes de crear un aviso se comprueba que no exista ya uno con el mismo `type` + `data.refId` + `userId`.

### Correo (Resend)

- Paquetes `resend` y `@react-email/components`. Las plantillas viven en `src/notifications/emails/` y comparten un mismo diseño: logo, título, texto y botón "Ver en Alumbra".
- Remitente: `Alumbra <notificaciones@iglesiaalumbra.org>`, con respuesta a `info@iglesiaalumbra.org`.
- Requiere verificar `iglesiaalumbra.org` en Resend (registros SPF/DKIM en el DNS) y configurar `RESEND_API_KEY` como secreto en Cloud Run.
- Sin `RESEND_API_KEY` (en dev), el correo se imprime en el log en vez de enviarse.
- El pie de cada correo lleva un enlace a `/perfil/notificaciones` para apagar ese tipo.
- El envío es asíncrono: se marca `emailedAt` al enviarlo y se reintenta 3 veces. Si un aviso no se pudo enviar, el siguiente `tick` lo reintenta.

### API (GraphQL)

- `notifications(first, after)` (paginado), `unreadNotificationCount`
- `markNotificationRead(id)`, `markAllNotificationsRead`
- `notificationPreferences` / `setNotificationPreference(type, email)`

### Frontend

- **Campana** en la barra superior de `app-shell`, con un contador de no leídas. Hace polling de `unreadNotificationCount` cada 45 s y vuelve a consultar en `visibilitychange`, cuando la pestaña recupera el foco. Al abrirla se ve una lista de los últimos 20 avisos y el enlace "Ver todas".
- Hacer clic en un aviso lo marca como leído y lleva a su `href`.
- `/notificaciones`: la lista completa.
- `/perfil/notificaciones`: un interruptor de correo por tipo, agrupados por módulo.

## Orden de construcción

1. `Notification`, `NotificationsService` y la campana (sin correo).
2. Solicitudes al Instituto, con permiso, portada con candado y pantalla de revisión, conectadas a la campana.
3. Avisos de eventos inmediatos de los demás módulos: muro, Acogida, Ruta y notas.
4. Resend: plantillas, preferencias y pie para darse de baja.
5. Recordatorios con Cloud Scheduler.

## Estado (2026-10-20)

- En producción: migraciones, backend y frontend desplegados.
- Resend: dominio `iglesiaalumbra.org` verificado, key en `alumbra-resend-api-key`. Los correos salen desde `notificaciones@iglesiaalumbra.org` con respuestas a `info@iglesiaalumbra.org`.
- Recordatorios: secreto `alumbra-cron-token` y job `alumbra-recordatorios` cada 15 minutos.
- El rechazo del acceso a la app no se avisa (confirmado).
