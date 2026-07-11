# Spec D — Cursos (Evangelio + Ruta de Crecimiento) y pipeline de membresía

**Fecha:** 2026-07-10
**Estado:** Aprobado (decisiones tomadas con Jose en sesión)
**Depende de:** Spec C (grupos con clases/asistencia/trabajos).

## Contexto

Así se llega a ser miembro:

1. **Pre-entrevista** con un entrevistador.
2. **Validación** del entrevistador para entrar a la Ruta. Requisito: haber **terminado el curso de Evangelio**.
3. **Ruta de Crecimiento**: curso con estructura taxonómica fija (temas → clases → tareas) que se respeta en orden.
4. Al terminar: el candidato entrega **ensayo (~2000 palabras), testimonio e imagen**.
5. **Filtro de la iglesia**: se notifica a todos los miembros (anuncio en el feed) para que llenen un formulario de observaciones sobre el carácter del candidato.
6. Si pasa: **entrevista presencial con los pastores** y firma del **pacto de membresía** → la persona pasa a ser MIEMBRO.

**Evangelio** viene antes de la Ruta: estructura simple, abierto a todo el mundo, con programación semanal.

## Decisiones

- **Temario fijo**: el currículo se carga por seed; sin editor de UI en v1.
- **Observaciones con nombre, visibles solo para pastores**. Una por miembro por candidato (editable).
- **Evangelio terminado = certificación manual** del líder de una cohorte de Evangelio o un pastor (`CourseCompletion`).
- **Notificación del filtro = anuncio automático fijado en el feed** (email llega con Resend/Google OAuth después).

## Modelo

### Currículo (plantilla, seed)

```prisma
model Course      { slug @unique, name, description?, prerequisiteId? }  // ruta-crecimiento requiere evangelio
model CourseTopic { courseId, order, title, description? }              // tema
model CourseLesson{ topicId, order, title, description? }               // clase (plantilla)
model CourseLessonTask { lessonId, order, title, description? }         // tarea (plantilla)
model CourseCompletion { userId, courseId, completedAt, certifiedById; @@unique([userId, courseId]) }
```

### Cohortes = grupos

`Group` gana `courseId?` y el tipo `CURSO`. Una cohorte reutiliza TODO lo de Spec C (clases, asistencia, material, trabajos, calendario, horario semanal).

- Cohorte de **Ruta**: líder debe ser pastor. Solo se agregan personas con journey en etapa `VALIDADO`+ (la vía normal es `assignJourneyToRuta`).
- Cohorte de **Evangelio**: abierta — cualquier rol puede ser miembro.
- `GroupSession` gana `lessonId?`: la clase concreta implementa una clase del currículo.
  - En cohortes de Ruta el **orden se respeta**: solo se puede programar la lección siguiente (todas las anteriores deben tener clase creada).
  - Al programar con `lessonId`, las **tareas de la plantilla se crean automáticamente** como `SessionAssignment`.

### Pipeline de membresía

```prisma
enum JourneyStage {
  PRE_ENTREVISTA   // registrada la pre-entrevista
  VALIDADO         // entrevistador aprobó la entrada (exige CourseCompletion de Evangelio)
  EN_RUTA          // asignado a cohorte de Ruta
  ENTREGA_FINAL    // terminó la Ruta; debe entregar ensayo + testimonio + imagen
  FILTRO_IGLESIA   // entrega recibida; formulario abierto a los miembros
  ENTREVISTA_PASTORAL // pasó el filtro; citado con pastores
  MIEMBRO          // pacto firmado
  NO_CONTINUA      // no aprobado / desistió (en cualquier etapa)
}

model MembershipJourney {
  userId @unique
  stage JourneyStage @default(PRE_ENTREVISTA)
  interviewerId?; preInterviewAt?; preInterviewNotes?
  validatedAt?
  rutaGroupId?; rutaCompletedAt?
  essayUrl?; testimony?; imageUrl?; finalSubmittedAt?
  churchFilterOpenedAt?; churchFilterClosedAt?; churchFilterPassed?
  pastoralInterviewAt?; covenantSignedAt?
  notes? // notas internas pastorales
}

model ChurchObservation { journeyId, authorId, body; @@unique([journeyId, authorId]) }
```

### Transiciones (cada una valida la etapa actual)

| Mutation | Quién | Efecto |
|---|---|---|
| `startMembershipJourney(userId, …)` | Pastor o líder de ministerio (acogida) | Crea journey en `PRE_ENTREVISTA`; entrevistador = caller por defecto |
| `validateJourney(id, approved, notes?)` | Entrevistador asignado o pastor | Exige Evangelio certificado. `VALIDADO` o `NO_CONTINUA` |
| `assignJourneyToRuta(id, groupId)` | Entrevistador o pastor | Agrega a la cohorte (grupo de curso ruta) → `EN_RUTA` |
| `completeRuta(id)` | Líder de la cohorte o pastor | → `ENTREGA_FINAL` |
| `submitFinalWork(essayUrl, testimony, imageUrl)` | El propio candidato | Guarda entrega, `finalSubmittedAt` (queda en `ENTREGA_FINAL` hasta abrir filtro) |
| `openChurchFilter(id)` | Pastor | Exige entrega completa. → `FILTRO_IGLESIA` + **anuncio fijado automático** en el feed |
| `addChurchObservation(journeyId, body)` | Cualquier MIEMBRO (no el candidato) | Upsert de su observación |
| `closeChurchFilter(id, passed, interviewAt?)` | Pastor | → `ENTREVISTA_PASTORAL` o `NO_CONTINUA` |
| `signCovenant(id, date?)` | Pastor | → `MIEMBRO`. Side effects: `baseRole=MIEMBRO`, `canSignIn=true`, `membershipDate=fecha del pacto` |
| `certifyCourseCompletion(userId, courseId)` | Líder de cohorte de ese curso o pastor | Upsert `CourseCompletion` |

### Visibilidad

- `myJourney`: el candidato ve su propio journey completo (etapas + entrega).
- `membershipJourneys(stage?)`: tablero, solo pastores (el entrevistador ve los suyos vía `myInterviews`).
- `journeyObservations(journeyId)`: **solo pastores** (con autor).
- `churchFilterFor(userId)`: para MIEMBROs — devuelve el filtro abierto del candidato (si existe) + mi observación previa; alimenta el formulario en el perfil del candidato.
- `courses`: currículo completo, autenticado.
- `courseCompletions(userId)`: autenticado (badge "Evangelio ✓" en el perfil).

## Front

- Sidebar: página **Ruta** (`/ruta`) — pastores: tablero por etapa con las acciones; candidato: stepper de su progreso + formulario de entrega final (ensayo archivo, testimonio texto, imagen).
- Grupos: crear cohorte eligiendo curso; el detalle de una cohorte muestra el temario con el avance (clases programadas por lección) y "Programar clase" ofrece la **siguiente lección** del currículo.
- Perfil: badge "Evangelio ✓", botón "Certificar Evangelio" (líder/pastor), y durante el filtro: formulario de observación (miembros) / lista de observaciones (pastores).
- El anuncio del filtro aparece en el feed como cualquier anuncio fijado.

## Seed

- Cursos `evangelio` y `ruta-crecimiento` (con prerrequisito) + currículo placeholder editable en DB:
  - Evangelio: 1 tema, 6 clases, sin tareas.
  - Ruta: 4 temas × ~3 clases, con tareas por clase (incluye "Escribir mi testimonio").

## Fuera de alcance

- Editor de currículo en UI.
- Email a la iglesia (queda ligado a la integración de Resend).
- Conteo automático de palabras del ensayo (revisión humana; la UI lo indica).
- Avance automático de etapa por asistencia/tareas completadas.

## Criterio de "hecho"

1. Migración + seed del currículo aplicados.
2. Pipeline completo con validaciones de etapa y permisos; anuncio automático al abrir filtro; side effects del pacto (rol/membershipDate/canSignIn).
3. Orden taxonómico enforced al programar clases de Ruta; tareas auto-generadas desde la plantilla.
4. Tests de integración del pipeline (happy path + violaciones de etapa/permiso/prerrequisito) + e2e del flujo completo hasta MIEMBRO.
5. Front: `/ruta` (tablero + stepper + entrega final), cohortes con temario, perfil con certificación/filtro.
6. Suites y builds verdes en ambos repos.
