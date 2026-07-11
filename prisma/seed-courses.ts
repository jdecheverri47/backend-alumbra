import { PrismaClient } from '@prisma/client';

export const EVANGELIO_SLUG = 'evangelio';
export const RUTA_SLUG = 'ruta-crecimiento';

type Curriculum = Array<{
  title: string;
  description?: string;
  lessons: Array<{ title: string; description?: string; tasks?: string[] }>;
}>;

const EVANGELIO_CURRICULUM: Curriculum = [
  {
    title: 'El Evangelio',
    description: 'Curso abierto a todo el mundo: las buenas noticias de Jesús.',
    lessons: [
      { title: 'Creación: el diseño de Dios' },
      { title: 'La caída: el problema del pecado' },
      { title: 'Redención: la obra de Cristo' },
      { title: 'Fe y arrepentimiento' },
      { title: 'La cruz y la gracia' },
      { title: 'Resurrección y vida nueva' },
    ],
  },
];

const RUTA_CURRICULUM: Curriculum = [
  {
    title: 'Identidad',
    lessons: [
      { title: 'Identidad en Cristo', tasks: ['Reflexión escrita: ¿quién soy en Cristo?'] },
      { title: 'Hijos de Dios', tasks: ['Memorizar y comentar Romanos 8:14-17'] },
    ],
  },
  {
    title: 'Fundamentos',
    lessons: [
      { title: 'La Palabra', tasks: ['Plan de lectura: una semana en el evangelio de Juan'] },
      { title: 'La oración', tasks: ['Diario de oración de una semana'] },
      { title: 'El Espíritu Santo', tasks: ['Reflexión: el fruto del Espíritu en mi vida'] },
    ],
  },
  {
    title: 'Iglesia y comunidad',
    lessons: [
      { title: 'La iglesia local', tasks: ['Ensayo corto: por qué la iglesia local'] },
      { title: 'Membresía y pacto', tasks: ['Leer el pacto de membresía y anotar preguntas'] },
      { title: 'Servicio y dones', tasks: ['Test de dones y reflexión'] },
    ],
  },
  {
    title: 'Madurez',
    lessons: [
      { title: 'Mayordomía', tasks: ['Plan personal de mayordomía'] },
      { title: 'Evangelismo personal', tasks: ['Compartir el evangelio con una persona esta semana'] },
      { title: 'Mi testimonio', tasks: ['Escribir la primera versión de mi testimonio'] },
    ],
  },
];

/** Crea (idempotente) los cursos Evangelio y Ruta de Crecimiento con su currículo. */
export async function seedCourses(prisma: PrismaClient): Promise<void> {
  const evangelio = await upsertCourse(prisma, {
    slug: EVANGELIO_SLUG,
    name: 'Evangelio',
    description: 'Curso abierto para todos. Prerrequisito de la Ruta de Crecimiento.',
    curriculum: EVANGELIO_CURRICULUM,
  });

  await upsertCourse(prisma, {
    slug: RUTA_SLUG,
    name: 'Ruta de Crecimiento',
    description: 'El camino hacia la membresía. Requiere haber terminado Evangelio.',
    prerequisiteId: evangelio.id,
    curriculum: RUTA_CURRICULUM,
  });
}

async function upsertCourse(
  prisma: PrismaClient,
  opts: {
    slug: string;
    name: string;
    description: string;
    prerequisiteId?: string;
    curriculum: Curriculum;
  },
) {
  const course = await prisma.course.upsert({
    where: { slug: opts.slug },
    create: {
      slug: opts.slug,
      name: opts.name,
      description: opts.description,
      prerequisiteId: opts.prerequisiteId,
    },
    update: { prerequisiteId: opts.prerequisiteId },
  });

  // El currículo solo se siembra si el curso está vacío (no pisa ediciones manuales).
  const existingTopics = await prisma.courseTopic.count({ where: { courseId: course.id } });
  if (existingTopics > 0) return course;

  for (const [topicIndex, topic] of opts.curriculum.entries()) {
    const createdTopic = await prisma.courseTopic.create({
      data: {
        courseId: course.id,
        order: topicIndex + 1,
        title: topic.title,
        description: topic.description,
      },
    });
    for (const [lessonIndex, lesson] of topic.lessons.entries()) {
      await prisma.courseLesson.create({
        data: {
          topicId: createdTopic.id,
          order: lessonIndex + 1,
          title: lesson.title,
          description: lesson.description,
          tasks: {
            create: (lesson.tasks ?? []).map((title, taskIndex) => ({
              order: taskIndex + 1,
              title,
            })),
          },
        },
      });
    }
  }
  return course;
}
