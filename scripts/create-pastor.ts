import { parseArgs } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

const schema = z.object({
  email: z.string().trim().email().transform((v) => v.toLowerCase()),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
});

async function main() {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      firstName: { type: 'string' },
      lastName: { type: 'string' },
    },
  });

  const input = schema.safeParse(values);
  if (!input.success) {
    console.error('Missing or invalid arguments. Usage:');
    console.error('  pnpm tsx scripts/create-pastor.ts --email jane@x.com --firstName Jane --lastName Doe');
    console.error('Errors:', input.error.issues);
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.upsert({
      where: { email: input.data.email },
      create: {
        ...input.data,
        baseRole: 'MIEMBRO',
        isPastor: true,
      },
      update: {
        firstName: input.data.firstName,
        lastName: input.data.lastName,
        baseRole: 'MIEMBRO',
        isPastor: true,
      },
    });
    console.log(`Pastor ready: ${user.email} (${user.id})`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
