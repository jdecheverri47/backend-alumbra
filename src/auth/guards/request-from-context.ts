import { ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { Request } from 'express';
import { AuthenticatedUser } from '../types/authenticated-user';

export type RequestWithUser = Request & { user?: AuthenticatedUser };

/** Extracts the express request from either an HTTP or a GraphQL execution context. */
export function requestFromContext(context: ExecutionContext): RequestWithUser {
  if (context.getType<string>() === 'graphql') {
    return GqlExecutionContext.create(context).getContext<{ req: RequestWithUser }>().req;
  }
  return context.switchToHttp().getRequest<RequestWithUser>();
}
