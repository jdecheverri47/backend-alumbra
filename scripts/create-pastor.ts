import { parseArgs } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import { z } from 'zod';

const schema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .transform((v) => v.toLowerCase()),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  password: z.string().min(8, 'Password must be at least 8 characters long'),
});

async function main() {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      firstName: { type: 'string' },
      lastName: { type: 'string' },
      password: { type: 'string' },
    },
  });

  const input = schema.safeParse(values);
  if (!input.success) {
    console.error('Missing or invalid arguments. Usage:');
    console.error(
      '  pnpm tsx scripts/create-pastor.ts --email jane@x.com --firstName Jane --lastName Doe --password <min 8 chars>',
    );
    console.error('Errors:', input.error.issues);
    process.exit(1);
  }

  const { password, ...profile } = input.data;
  const passwordHash = await hash(password, 10);

  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.upsert({
      where: { email: profile.email },
      create: {
        ...profile,
        baseRole: 'MIEMBRO',
        isPastor: true,
        canSignIn: true,
        passwordHash,
      },
      update: {
        firstName: profile.firstName,
        lastName: profile.lastName,
        baseRole: 'MIEMBRO',
        isPastor: true,
        canSignIn: true,
        passwordHash,
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
