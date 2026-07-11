import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import { compare } from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { ttlToSeconds } from '../config/env.schema';
import { PrismaService } from '../prisma/prisma.service';
import { loginSchema } from './dto/login.schema';

export interface RequestMeta {
  userAgent?: string;
  ipAddress?: string;
}

export interface IssuedTokens {
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  get refreshTtlDays(): number {
    return this.config.get<number>('REFRESH_TTL_DAYS') ?? 30;
  }

  async login(raw: unknown, meta: RequestMeta): Promise<IssuedTokens & { user: User }> {
    const { email, password } = loginSchema.parse(raw);

    // findFirst goes through the soft-delete middleware, so deleted users
    // fall into the same generic error as unknown emails — no enumeration.
    const user = await this.prisma.user.findFirst({ where: { email } });
    const passwordOk = user?.passwordHash ? await compare(password, user.passwordHash) : false;
    if (!user || !passwordOk) {
      throw new UnauthorizedException({
        error: 'INVALID_CREDENTIALS',
        message: 'Email o contraseña incorrectos.',
      });
    }
    if (!user.canSignIn) {
      throw new ForbiddenException({
        error: 'ACCESS_NOT_GRANTED',
        message:
          'Aún no tienes acceso a la app. Espera a que te convoquen a la ruta de crecimiento.',
      });
    }

    const tokens = await this.issueTokens(user, meta);
    return { ...tokens, user };
  }

  async refresh(refreshToken: string | undefined, meta: RequestMeta): Promise<IssuedTokens> {
    if (!refreshToken) {
      throw new UnauthorizedException({
        error: 'NO_REFRESH_TOKEN',
        message: 'Missing refresh token.',
      });
    }

    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash: hashRefreshToken(refreshToken) },
      include: { user: true },
    });
    if (!session) {
      throw this.invalidRefresh();
    }
    if (session.revokedAt) {
      // Reuse of a rotated/revoked token — assume the refresh token leaked and
      // kill every session of this user.
      await this.prisma.session.updateMany({
        where: { userId: session.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw this.invalidRefresh();
    }
    if (
      session.expiresAt <= new Date() ||
      session.user.deletedAt !== null ||
      !session.user.canSignIn
    ) {
      throw this.invalidRefresh();
    }

    // Rotation: the previous refresh token becomes invalid.
    const newRefreshToken = randomBytes(32).toString('base64url');
    await this.prisma.session.update({
      where: { id: session.id },
      data: {
        refreshTokenHash: hashRefreshToken(newRefreshToken),
        lastUsedAt: new Date(),
        expiresAt: this.refreshExpiry(),
        userAgent: meta.userAgent ?? session.userAgent,
        ipAddress: meta.ipAddress ?? session.ipAddress,
      },
    });

    const access = await this.issueAccessToken(session.user);
    return { ...access, refreshToken: newRefreshToken };
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    await this.prisma.session.updateMany({
      where: { refreshTokenHash: hashRefreshToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueTokens(user: User, meta: RequestMeta): Promise<IssuedTokens> {
    const refreshToken = randomBytes(32).toString('base64url');
    await this.prisma.session.create({
      data: {
        userId: user.id,
        refreshTokenHash: hashRefreshToken(refreshToken),
        userAgent: meta.userAgent,
        ipAddress: meta.ipAddress,
        expiresAt: this.refreshExpiry(),
      },
    });
    const access = await this.issueAccessToken(user);
    return { ...access, refreshToken };
  }

  private async issueAccessToken(
    user: User,
  ): Promise<Pick<IssuedTokens, 'accessToken' | 'accessTokenExpiresAt'>> {
    const ttlSeconds = ttlToSeconds(this.config.get<string>('JWT_ACCESS_TTL') ?? '15m');
    const accessToken = await this.jwtService.signAsync(
      { sub: user.id, email: user.email, isPastor: user.isPastor, baseRole: user.baseRole },
      { expiresIn: ttlSeconds },
    );
    return {
      accessToken,
      accessTokenExpiresAt: new Date(Date.now() + ttlSeconds * 1000),
    };
  }

  private refreshExpiry(): Date {
    return new Date(Date.now() + this.refreshTtlDays * 24 * 3600 * 1000);
  }

  private invalidRefresh(): UnauthorizedException {
    return new UnauthorizedException({
      error: 'INVALID_REFRESH_TOKEN',
      message: 'Invalid, expired or revoked refresh token.',
    });
  }
}
