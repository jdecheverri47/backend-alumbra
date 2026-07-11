# Spec B — Feed, calendario y grupos de crecimiento

**Fecha:** 2026-07-10
**Estado:** Aprobado (decisiones tomadas con Jose en sesión)
**Depende de:** Spec A (users/roles/ministries) y auth por credenciales.

## Contexto

El dashboard es un feed estilo Facebook: posts, anuncios, imágenes y eventos. Además, la iglesia opera **grupos de crecimiento** presenciales:

- **Grupos de madurez**: acceden miembros y asistentes; los dirige un pastor.
- **Grupos de conexión**: para asistentes; los dirige un "principal" (no necesariamente pastor).

Cada usuario ve en su calendario los eventos generales, los eventos de sus grupos y las reuniones semanales de sus grupos.

## Decisiones de producto

1. **Publican solo pastores y líderes** (líder de grupo o líder de ministerio). Los anuncios (`ANUNCIO`, fijables arriba del feed) son exclusivos de pastores.
2. **Reacciones + comentarios desde v1.** Una reacción por usuario por post (tipos: `LIKE`, `AMEN`, `LOVE`).
3. **Imágenes a disco local** (`uploads/`), servidas por el backend en `/uploads/*`. Migrar a storage externo (GCS/S3) antes de producción — el contrato (URL en `PostImage.url`) no cambia.
4. **Invitar = agregar directo.** El líder/pastor agrega al usuario a su grupo sin flujo de aceptación.

## Schema (Prisma)

```prisma
enum GroupType { MADUREZ CONEXION }
enum PostType { POST ANUNCIO }
enum ReactionType { LIKE AMEN LOVE }

model Group {
  id          String  @id @default(cuid())
  type        GroupType
  name        String
  description String?
  leaderId    String        // pastor para MADUREZ; cualquier user para CONEXION
  meetingDay  Int?          // 0=domingo … 6=sábado
  meetingTime String?       // "19:00"
  location    String?
  archivedAt  DateTime?
  memberships GroupMembership[]
  events      Event[]
}

model GroupMembership {
  userId    String
  groupId   String
  addedById String?   // quién lo agregó
  joinedAt  DateTime  @default(now())
  leftAt    DateTime?
  @@unique([userId, groupId, joinedAt])
}

model Event {
  id          String    @id @default(cuid())
  title       String
  description String?
  location    String?
  startsAt    DateTime
  endsAt      DateTime?
  groupId     String?   // null = evento general (visible para todos)
  createdById String
}

model Post {
  id        String    @id @default(cuid())
  authorId  String
  type      PostType  @default(POST)
  body      String
  pinnedAt  DateTime? // solo ANUNCIO; orden del bloque fijado
  eventId   String?   // post que difunde un evento
  deletedAt DateTime?
  images    PostImage[]
  reactions PostReaction[]
  comments  PostComment[]
}

model PostImage    { postId, url, position }
model PostReaction { postId, userId, type; @@unique([postId, userId]) }
model PostComment  { postId, authorId, body, deletedAt? }
```

## Reglas de autorización

| Operación | Regla |
|---|---|
| `feed`, `pinnedAnnouncements`, `post(id)`, comments | Autenticado |
| `createPost(type: POST)` | Pastor, líder de grupo activo o líder de ministerio |
| `createPost(type: ANUNCIO)`, `setPostPinned` | Pastor |
| `deletePost` | Autor o pastor (soft delete) |
| `reactToPost`, `removePostReaction`, `addPostComment` | Autenticado |
| `deletePostComment` | Autor del comentario, autor del post o pastor |
| `myGroups` | Autenticado (grupos donde soy miembro activo o líder) |
| `group(id)` | Miembro activo, líder o pastor |
| `groups` | Pastor |
| `createGroup`, `archiveGroup` | Pastor |
| `updateGroup` | Pastor o líder del grupo |
| `addUserToGroup`, `removeUserFromGroup` | Pastor o líder del grupo |
| `events(from,to)` | Autenticado — generales + de mis grupos (pastor ve todos) |
| `createEvent` general | Pastor |
| `createEvent` de grupo | Pastor o líder de ese grupo |
| `updateEvent`, `deleteEvent` | Creador o pastor |
| `POST /uploads` | Autenticado (multipart `file`, solo imágenes, máx 5 MB) |

Validación de negocio: a un grupo `CONEXION` solo se agregan usuarios con `baseRole: ASISTENTE` (los grupos de conexión son la puerta de entrada; un miembro pertenece a madurez). A `MADUREZ` entran ambos roles. El líder de un grupo `MADUREZ` debe ser pastor.

## Calendario

No hay motor de recurrencia en v1. El calendario del usuario se compone en el cliente:

1. `events(from, to)` — eventos puntuales visibles.
2. `myGroups` — cada grupo con `meetingDay`/`meetingTime`/`location`; el front proyecta la reunión semanal dentro del rango.

## Feed

- `feed(pagination)` — cursor (reutiliza `common/pagination`), posts no eliminados, `createdAt desc`.
- `pinnedAnnouncements` — `pinnedAt != null`, orden `pinnedAt desc`; el front los muestra arriba.
- `PostModel` expone `reactionCounts { type count }`, `myReaction` y `commentCount`; `comments(postId)` es query aparte (asc, sin paginar en v1).

## Uploads

`POST /uploads` (multipart, campo `file`) → `{ "url": "/uploads/<uuid>.<ext>" }`. Directorio `UPLOAD_DIR` (default `./uploads`, gitignored), servido estático bajo `/uploads`. Solo `image/jpeg|png|webp|gif`, máx 5 MB.

## Fuera de alcance v1

- Recurrencia real de eventos (RRULE) y RSVP/asistencia.
- Notificaciones (push/email) de posts o invitaciones a grupo.
- Storage externo de imágenes (Cloudinary/GCS) — pendiente antes de producción.
- Edición de posts/comentarios (solo crear/eliminar en v1).
- Feeds por grupo (el feed es global).

## Criterio de "hecho"

1. Migración aplicada; seed crea un grupo de madurez de ejemplo liderado por el pastor seed.
2. Módulos `groups`, `events`, `feed`, `uploads` con la matriz de autorización aplicada.
3. Tests: integración de servicios (permisos y validaciones de negocio) + e2e del flujo feed (publicar → reaccionar → comentar) y grupos (crear → agregar miembro → validación CONEXION).
4. `pnpm test`, `pnpm test:e2e`, `pnpm lint`, `pnpm build` verdes.
5. Front: feed con composer (solo quien puede publicar), anuncios fijados, reacciones, comentarios, imágenes; página de calendario (agenda 30 días + reuniones semanales); página de grupos con gestión de miembros para líderes.
