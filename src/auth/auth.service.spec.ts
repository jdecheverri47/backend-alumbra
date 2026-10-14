import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { User } from '@prisma/client';
import { hash } from 'bcryptjs';
import { requireLocalDb } from '../../test/setup/require-local-db';
import { AccessRequestsService } from '../access-requests/access-requests.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService, hashRefreshToken } from './auth.service';
import { GoogleIdentity, GoogleTokenVerifier } from './google-token.verifier';

const PASSWORD = 'super-secret-1';
const CONFIG_STUB = {
  get: (key: string) =>
    ({ JWT_ACCESS_TTL: '15m', REFRESH_TTL_DAYS: 30 })[key as 'JWT_ACCESS_TTL' | 'REFRESH_TTL_DAYS'],
};

// El "token" de Google en los tests es la llave de este mapa: así cada caso
// decide qué identidad devuelve Google sin hablar con Google.
const GOOGLE_IDENTITIES: Record<string, GoogleIdentity> = {
  ana: {
    googleId: 'g-ana',
    email: 'ana@alumbra.test',
    firstName: 'Ana',
    lastName: 'Perez',
    photoUrl: 'https://lh3.googleusercontent.com/ana',
  },
  nuevo: {
    googleId: 'g-nuevo',
    email: 'nuevo@alumbra.test',
    firstName: 'Nuevo',
    lastName: 'Visitante',
    photoUrl: null,
  },
};
const GOOGLE_STUB = {
  verify: async (credential: string) => {
    const identity = GOOGLE_IDENTITIES[credential];
    if (!identity) throw new UnauthorizedException({ error: 'INVALID_GOOGLE_TOKEN' });
    return identity;
  },
};

describe('AuthService', () => {
  let service: AuthService;
  let jwtService: JwtService;
  let prisma: PrismaService;

  const wipe = async () => {
    await prisma.$executeRawUnsafe('DELETE FROM "AccessRequest"');
    await prisma.$executeRawUnsafe('DELETE FROM "Session"');
    await prisma.$executeRawUnsafe('DELETE FROM "MinistryMembership"');
    await prisma.$executeRawUnsafe('DELETE FROM "User"');
  };

  const createUser = async (overrides: Partial<User> = {}) =>
    prisma.user.create({
      data: {
        email: 'ana@alumbra.test',
        firstName: 'Ana',
        lastName: 'Perez',
        baseRole: 'MIEMBRO',
        canSignIn: true,
        passwordHash: await hash(PASSWORD, 10),
        ...overrides,
      },
    });

  beforeAll(async () => {
    requireLocalDb();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        PrismaService,
        {
          provide: JwtService,
          useValue: new JwtService({ secret: 'test-secret-of-32-characters-min!!' }),
        },
        { provide: ConfigService, useValue: CONFIG_STUB },
        { provide: GoogleTokenVerifier, useValue: GOOGLE_STUB },
        AccessRequestsService,
      ],
    }).compile();

    service = moduleRef.get(AuthService);
    jwtService = moduleRef.get(JwtService);
    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();
    await wipe();
  });

  beforeEach(async () => {
    await wipe();
  });

  afterAll(async () => {
    await wipe();
    await prisma.$disconnect();
  });

  describe('login', () => {
    it('rejects unknown email, wrong password, and users without a password hash alike', async () => {
      await createUser();
      await createUser({ email: 'sinpass@alumbra.test', passwordHash: null });

      await expect(
        service.login({ email: 'nadie@alumbra.test', password: PASSWORD }, {}),
      ).rejects.toMatchObject({ response: { error: 'INVALID_CREDENTIALS' } });
      await expect(
        service.login({ email: 'ana@alumbra.test', password: 'wrong' }, {}),
      ).rejects.toMatchObject({ response: { error: 'INVALID_CREDENTIALS' } });
      await expect(
        service.login({ email: 'sinpass@alumbra.test', password: PASSWORD }, {}),
      ).rejects.toMatchObject({ response: { error: 'INVALID_CREDENTIALS' } });
    });

    it('rejects soft-deleted users with the generic error', async () => {
      await createUser({ deletedAt: new Date() });
      await expect(
        service.login({ email: 'ana@alumbra.test', password: PASSWORD }, {}),
      ).rejects.toMatchObject({ response: { error: 'INVALID_CREDENTIALS' } });
    });

    it('rejects canSignIn=false with ACCESS_NOT_GRANTED', async () => {
      await createUser({ canSignIn: false });
      await expect(
        service.login({ email: 'ana@alumbra.test', password: PASSWORD }, {}),
      ).rejects.toMatchObject({ response: { error: 'ACCESS_NOT_GRANTED' } });
    });

    it('issues a valid access JWT and persists a hashed session', async () => {
      const user = await createUser();
      const result = await service.login(
        { email: 'ANA@alumbra.test', password: PASSWORD },
        { userAgent: 'jest', ipAddress: '127.0.0.1' },
      );

      const payload = await jwtService.verifyAsync(result.accessToken);
      expect(payload.sub).toBe(user.id);
      expect(payload.baseRole).toBe('MIEMBRO');

      const session = await prisma.session.findUnique({
        where: { refreshTokenHash: hashRefreshToken(result.refreshToken) },
      });
      expect(session?.userId).toBe(user.id);
      expect(session?.userAgent).toBe('jest');
      // The plain refresh token is never stored.
      expect(session?.refreshTokenHash).not.toBe(result.refreshToken);
    });
  });

  describe('refresh', () => {
    it('rotates the token: old one stops working, new one works', async () => {
      await createUser();
      const first = await service.login({ email: 'ana@alumbra.test', password: PASSWORD }, {});

      const second = await service.refresh(first.refreshToken, {});
      expect(second.refreshToken).not.toBe(first.refreshToken);

      // Old token no longer maps to a session → reuse path revokes everything.
      await expect(service.refresh(first.refreshToken, {})).rejects.toMatchObject({
        response: { error: 'INVALID_REFRESH_TOKEN' },
      });
    });

    it('revokes ALL user sessions when a revoked token is reused', async () => {
      const user = await createUser();
      const a = await service.login({ email: 'ana@alumbra.test', password: PASSWORD }, {});
      const b = await service.login({ email: 'ana@alumbra.test', password: PASSWORD }, {});

      await service.logout(a.refreshToken);
      await expect(service.refresh(a.refreshToken, {})).rejects.toMatchObject({
        response: { error: 'INVALID_REFRESH_TOKEN' },
      });

      const active = await prisma.session.count({ where: { userId: user.id, revokedAt: null } });
      expect(active).toBe(0);
      // Session B was collateral damage, as designed.
      await expect(service.refresh(b.refreshToken, {})).rejects.toMatchObject({
        response: { error: 'INVALID_REFRESH_TOKEN' },
      });
    });

    it('rejects expired sessions and missing tokens', async () => {
      await createUser();
      const { refreshToken } = await service.login(
        { email: 'ana@alumbra.test', password: PASSWORD },
        {},
      );
      await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

      await expect(service.refresh(refreshToken, {})).rejects.toMatchObject({
        response: { error: 'INVALID_REFRESH_TOKEN' },
      });
      await expect(service.refresh(undefined, {})).rejects.toMatchObject({
        response: { error: 'NO_REFRESH_TOKEN' },
      });
    });

    it('rejects refresh when the user lost sign-in access after logging in', async () => {
      const user = await createUser();
      const { refreshToken } = await service.login(
        { email: 'ana@alumbra.test', password: PASSWORD },
        {},
      );
      await prisma.user.update({ where: { id: user.id }, data: { canSignIn: false } });

      await expect(service.refresh(refreshToken, {})).rejects.toMatchObject({
        response: { error: 'INVALID_REFRESH_TOKEN' },
      });
    });
  });

  describe('logout', () => {
    it('revokes the matching session and is a no-op without token', async () => {
      const user = await createUser();
      const { refreshToken } = await service.login(
        { email: 'ana@alumbra.test', password: PASSWORD },
        {},
      );

      await service.logout(refreshToken);
      const session = await prisma.session.findFirst({ where: { userId: user.id } });
      expect(session?.revokedAt).not.toBeNull();

      await expect(service.logout(undefined)).resolves.toBeUndefined();
    });
  });

  describe('loginWithGoogle', () => {
    it('signs in an enabled user found by email and links the Google account', async () => {
      const user = await createUser({ passwordHash: null });

      const { accessToken, user: signedIn } = await service.loginWithGoogle(
        { credential: 'ana' },
        {},
      );

      expect(signedIn.id).toBe(user.id);
      const payload = await jwtService.verifyAsync<{ sub: string }>(accessToken);
      expect(payload.sub).toBe(user.id);
      const linked = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(linked.googleId).toBe('g-ana');
      expect(linked.photoUrl).toBe('https://lh3.googleusercontent.com/ana');
    });

    it('finds the user by googleId even if the Google email changed', async () => {
      const user = await createUser({ email: 'viejo@alumbra.test', googleId: 'g-ana' });

      const { user: signedIn } = await service.loginWithGoogle({ credential: 'ana' }, {});

      expect(signedIn.id).toBe(user.id);
    });

    it('rejects an email already linked to a different Google account', async () => {
      await createUser({ googleId: 'g-otro' });

      await expect(service.loginWithGoogle({ credential: 'ana' }, {})).rejects.toMatchObject({
        response: { error: 'GOOGLE_ACCOUNT_MISMATCH' },
      });
    });

    it('turns an unknown person into a pending request without creating a user', async () => {
      await expect(service.loginWithGoogle({ credential: 'nuevo' }, {})).rejects.toMatchObject({
        response: { error: 'ACCESS_PENDING', request: { firstName: 'Nuevo', hasDetails: false } },
      });

      expect(await prisma.user.count()).toBe(0);
      const request = await prisma.accessRequest.findUniqueOrThrow({
        where: { email: 'nuevo@alumbra.test' },
      });
      expect(request).toMatchObject({ status: 'PENDING', googleId: 'g-nuevo', userId: null });
    });

    it('lets the person complete their request with phone and note', async () => {
      await service.loginWithGoogle({ credential: 'nuevo' }, {}).catch(() => undefined);

      await expect(
        service.loginWithGoogle(
          { credential: 'nuevo', phone: '3001234567', note: 'Vine con mi tía' },
          {},
        ),
      ).rejects.toMatchObject({ response: { request: { hasDetails: true } } });

      expect(await prisma.accessRequest.count()).toBe(1);
      const request = await prisma.accessRequest.findFirstOrThrow();
      expect(request).toMatchObject({ phone: '3001234567', note: 'Vine con mi tía' });
    });

    it('links the request to an existing user that has no access yet', async () => {
      const user = await createUser({ canSignIn: false });

      await expect(service.loginWithGoogle({ credential: 'ana' }, {})).rejects.toMatchObject({
        response: { error: 'ACCESS_PENDING' },
      });

      const request = await prisma.accessRequest.findFirstOrThrow();
      expect(request.userId).toBe(user.id);
    });

    it('keeps a rejected request rejected', async () => {
      await service.loginWithGoogle({ credential: 'nuevo' }, {}).catch(() => undefined);
      await prisma.accessRequest.updateMany({ data: { status: 'REJECTED' } });

      await expect(service.loginWithGoogle({ credential: 'nuevo' }, {})).rejects.toMatchObject({
        response: { error: 'ACCESS_REJECTED' },
      });
      expect((await prisma.accessRequest.findFirstOrThrow()).status).toBe('REJECTED');
    });

    it('propagates an invalid Google token', async () => {
      await expect(service.loginWithGoogle({ credential: 'falso' }, {})).rejects.toMatchObject({
        response: { error: 'INVALID_GOOGLE_TOKEN' },
      });
    });
  });
});
