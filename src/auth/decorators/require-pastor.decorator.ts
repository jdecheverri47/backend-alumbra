import { SetMetadata } from '@nestjs/common';

export const REQUIRE_PASTOR_KEY = 'requirePastor';

/** Restricts a resolver to users with isPastor=true. Enforced by the global PastorGuard. */
export const RequirePastor = () => SetMetadata(REQUIRE_PASTOR_KEY, true);
