import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedUser } from '../types/authenticated-user';
import { requestFromContext } from '../guards/request-from-context';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = requestFromContext(context);
    return request.user as AuthenticatedUser;
  },
);
