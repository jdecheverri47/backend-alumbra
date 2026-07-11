import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_PASTOR_KEY } from '../decorators/require-pastor.decorator';
import { requestFromContext } from './request-from-context';

@Injectable()
export class PastorGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<boolean>(REQUIRE_PASTOR_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const request = requestFromContext(context);
    if (!request.user?.isPastor) {
      throw new ForbiddenException({
        error: 'FORBIDDEN',
        message: 'Only pastors can perform this action.',
      });
    }
    return true;
  }
}
