import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { BaseRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { requestFromContext } from './request-from-context';

interface AccessTokenPayload {
  sub: string;
  email: string;
  isPastor: boolean;
  baseRole: BaseRole;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = requestFromContext(context);
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
    if (!token) {
      throw new UnauthorizedException({
        error: 'UNAUTHENTICATED',
        message: 'Missing access token.',
      });
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token);
    } catch {
      throw new UnauthorizedException({
        error: 'UNAUTHENTICATED',
        message: 'Invalid or expired access token.',
      });
    }

    // Reload the user — don't trust the JWT alone in case isPastor/canSignIn changed
    // or the user was soft-deleted (middleware filters deleted rows out of findFirst).
    const user = await this.prisma.user.findFirst({ where: { id: payload.sub } });
    if (!user || !user.canSignIn) {
      throw new UnauthorizedException({
        error: 'UNAUTHENTICATED',
        message: 'Invalid or expired access token.',
      });
    }

    request.user = {
      sub: user.id,
      email: user.email,
      isPastor: user.isPastor,
      baseRole: user.baseRole,
      user,
    };
    return true;
  }
}
