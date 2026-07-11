import { INestApplication } from '@nestjs/common';
import { BaseRole, PrismaClient, User } from '@prisma/client';
import { hash } from 'bcryptjs';
import request from 'supertest';

export interface TestUserOptions {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  baseRole?: BaseRole;
  isPastor?: boolean;
  canSignIn?: boolean;
}

export async function createUserWithPassword(
  prisma: PrismaClient,
  opts: TestUserOptions,
): Promise<User> {
  return prisma.user.create({
    data: {
      email: opts.email,
      firstName: opts.firstName ?? 'Test',
      lastName: opts.lastName ?? 'User',
      baseRole: opts.baseRole ?? 'MIEMBRO',
      isPastor: opts.isPastor ?? false,
      canSignIn: opts.canSignIn ?? true,
      passwordHash: await hash(opts.password, 10),
    },
  });
}

export interface LoginResult {
  accessToken: string;
  /** Raw Set-Cookie header values, for exercising /auth/refresh and /auth/logout. */
  cookies: string[];
  body: Record<string, unknown>;
}

export async function login(
  app: INestApplication,
  email: string,
  password: string,
): Promise<LoginResult> {
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password })
    .expect(200);
  return {
    accessToken: res.body.accessToken as string,
    cookies: (res.headers['set-cookie'] as unknown as string[]) ?? [],
    body: res.body as Record<string, unknown>,
  };
}
