import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
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
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
