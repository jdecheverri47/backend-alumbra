import { PrismaClient } from '@prisma/client';
import { seedCourses } from './seed-courses';

const prisma = new PrismaClient();

async function main() {
  await seedCourses(prisma);
  console.log('Seed OK: cursos "evangelio" y "ruta-crecimiento" con su currículo');

  const acogida = await prisma.ministry.upsert({
    where: { slug: 'acogida' },
    create: {
      slug: 'acogida',
      name: 'Acogida',
      description: 'Ministerio encargado de recibir y registrar nuevos asistentes como prospectos.',
    },
    update: {},
  });
  console.log(`Seed OK: ministerio "${acogida.slug}" (${acogida.id})`);

  // Grupo de madurez de ejemplo, liderado por el primer pastor (si ya existe uno).
  const pastor = await prisma.user.findFirst({
    where: { isPastor: true, deletedAt: null },
    orderBy: { createdAt: 'asc' },
  });
  if (pastor) {
    const existing = await prisma.group.findFirst({
      where: { name: 'Madurez 1', leaderId: pastor.id },
    });
    const group =
      existing ??
      (await prisma.group.create({
        data: {
          type: 'MADUREZ',
          name: 'Madurez 1',
          description: 'Primer grupo de madurez.',
          leaderId: pastor.id,
          meetingDay: 4, // jueves
          meetingTime: '19:00',
          location: 'Sede principal',
        },
      }));
    console.log(`Seed OK: grupo "${group.name}" liderado por ${pastor.email} (${group.id})`);
  } else {
    console.log('Seed: no hay pastores todavía; corre create-pastor y vuelve a ejecutar el seed.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
