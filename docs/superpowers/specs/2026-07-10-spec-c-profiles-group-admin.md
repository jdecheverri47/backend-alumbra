# Spec C — Perfiles y administración de grupos (clases)

**Fecha:** 2026-07-10
**Estado:** Aprobado (decisiones tomadas con Jose en sesión)
**Depende de:** Spec B (feed/calendario/grupos) y auth.

## Perfil

Cada usuario tiene un perfil visible para cualquier autenticado (`/perfil/[id]`) y editable por sí mismo (`/perfil`).

### Campos nuevos en `User`

```prisma
coverUrl       String?   // imagen de portada
membershipDate DateTime? // fecha de anexo a membresía
baptismDate    DateTime? // fecha de bautismo (si es miembro)
```

`photoUrl` (foto de perfil) ya existía; ahora se puede subir vía `/uploads`.

### Reglas

- **Self-edit** (`updateUser`, ya con regla self-o-pastor): nombres, teléfono, fecha de nacimiento, `photoUrl`, `coverUrl`.
- **Solo pastores** (`setUserMembershipInfo(id, input)`): `membershipDate` y `baptismDate` — son registros de membresía, no autogestión.
- **Tag "Miembro"**: el front muestra badge según `baseRole` (y "Pastor" si `isPastor`) en perfil, buscador, chips de grupos, etc.

## Administración de grupos — clases

Cada grupo tiene **clases** (`GroupSession`): la instancia concreta de la reunión semanal de una semana dada.

```prisma
enum GroupSessionStatus { PROGRAMADA REPROGRAMADA CANCELADA }

model GroupSession {
  groupId      String
  scheduledFor DateTime // fecha canónica (la reunión original de esa semana)
  startsAt     DateTime // fecha/hora efectiva (≠ scheduledFor si fue reprogramada)
  status       GroupSessionStatus @default(PROGRAMADA)
  title        String?  // tema de la clase
  note         String?  // razón de reprogramación/cancelación
  @@unique([groupId, scheduledFor])
}

model SessionMaterial     { sessionId, title, url, uploadedById }          // material de la clase
model SessionAssignment   { sessionId, title, description?, dueAt? }      // trabajo dejado
model AssignmentSubmission{ assignmentId, userId, url, submittedAt; @@unique([assignmentId, userId]) }
model SessionAttendance   { sessionId, userId, checkedInAt, recordedById; @@unique([sessionId, userId]) }
```

### Reglas de autorización

| Operación | Regla |
|---|---|
| Ver clases / detalle / material / trabajos | Miembro activo del grupo, líder o pastor |
| `createGroupSession`, `rescheduleGroupSession`, `cancelGroupSession` | Líder del grupo o pastor |
| `checkInToSession(sessionId, userId)` | Líder o pastor. Registra `checkedInAt = now()` (hora de ingreso). Idempotente: conserva la primera hora. |
| `undoCheckIn` | Líder o pastor |
| `addSessionMaterial` / `removeSessionMaterial` | Líder o pastor |
| `createSessionAssignment` | Líder o pastor |
| `submitAssignment(assignmentId, url)` | Miembro activo del grupo (upsert: re-subir reemplaza y actualiza `submittedAt`) |
| Ver entregas (`submissions`) | Líder/pastor: todas (con quién y archivo). Miembro: solo la suya (`mySubmission`). |
| Ver asistencia | Líder/pastor: toda la lista con horas. Miembro: solo la propia. |

El filtrado por rol se hace en el service al armar el detalle (`groupSession(id)`), no con field resolvers.

### Calendario

`groupSessionsInRange(from, to)` devuelve las clases de mis grupos (pastor: todas). El front:
- No proyecta la reunión semanal genérica en la semana donde existe una `GroupSession` para ese grupo (la sesión la reemplaza).
- `CANCELADA` → chip tachado "Cancelada" en el día original.
- `REPROGRAMADA` → chip en la nueva fecha.

## Uploads

Se amplía `/uploads` para aceptar documentos además de imágenes (PDF, Word, Excel, PowerPoint, texto plano, ZIP), máx 10 MB — los trabajos y el material de clase son archivos.

## Buscador / directorio

- El buscador de personas (query `users(filter: { search })`) ya operaba; se agrega página `/personas` (directorio con búsqueda) y links al perfil desde chips/resultados.

## Fuera de alcance

- Auto check-in del miembro (QR / geolocalización) — el líder registra el ingreso en v1.
- Calificación/retroalimentación de trabajos.
- Recordatorios automáticos de clase o de trabajos pendientes.
- Historial de asistencia agregado (reportes) — solo por clase en v1.

## Criterio de "hecho"

1. Migración aplicada (campos de perfil + 5 tablas de clases).
2. Mutations/queries con la matriz aplicada; tests de integración de permisos y flujo (crear clase → reprogramar/cancelar → asistencia → trabajo → entrega) + e2e del flujo feliz.
3. Front: perfil propio editable (foto, portada, datos), perfil público con tags, directorio `/personas`, página de grupo `/grupos/[id]` con clases (reprogramar, cancelar, asistencia con hora, material, trabajos y entregas), calendario reflejando cancelaciones/reprogramaciones.
4. Suites verdes y builds limpios en ambos repos.
