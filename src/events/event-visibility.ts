import { BaseRole } from '@prisma/client';
import { AuthenticatedUser } from '../auth/types/authenticated-user';

/**
 * Los eventos marcados `membersOnly` solo los ven miembros y pastores. Para un
 * asistente es como si no existieran: ni en el calendario ni colgados de un post.
 *
 * Vive aparte porque la regla se aplica en dos sitios (eventos y feed) y si se
 * duplica, tarde o temprano uno de los dos se queda atrás.
 */
export function canSeeMembersOnly(me: AuthenticatedUser): boolean {
  return me.isPastor || me.baseRole === BaseRole.MIEMBRO;
}
