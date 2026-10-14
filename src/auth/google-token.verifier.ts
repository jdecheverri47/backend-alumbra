import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client, TokenPayload } from 'google-auth-library';

export interface GoogleIdentity {
  googleId: string;
  email: string;
  firstName: string;
  lastName: string;
  photoUrl: string | null;
}

/**
 * Valida el ID token que el botón de Google (Identity Services) le entrega al
 * frontend. No hay redirección OAuth del lado del servidor: el front manda el
 * token y aquí se comprueba firma, audiencia y expiración contra Google.
 *
 * Es un provider aparte para poder reemplazarlo en los tests.
 */
@Injectable()
export class GoogleTokenVerifier {
  private readonly client = new OAuth2Client();

  constructor(private readonly config: ConfigService) {}

  async verify(credential: string): Promise<GoogleIdentity> {
    const clientId = this.config.get<string>('GOOGLE_CLIENT_ID');
    if (!clientId) {
      throw new ServiceUnavailableException({
        error: 'GOOGLE_NOT_CONFIGURED',
        message: 'El ingreso con Google no está disponible por ahora.',
      });
    }

    let payload: TokenPayload | undefined;
    try {
      const ticket = await this.client.verifyIdToken({ idToken: credential, audience: clientId });
      payload = ticket.getPayload();
    } catch {
      payload = undefined;
    }
    // Sin email verificado no hay forma de saber que el correo es de quien entra,
    // y el correo es justo lo que se usa para encontrar su User.
    if (!payload?.sub || !payload.email || !payload.email_verified) {
      throw new UnauthorizedException({
        error: 'INVALID_GOOGLE_TOKEN',
        message: 'No pudimos validar tu cuenta de Google. Intenta de nuevo.',
      });
    }

    const email = payload.email.toLowerCase();
    return {
      googleId: payload.sub,
      email,
      firstName: payload.given_name ?? payload.name ?? email.split('@')[0],
      lastName: payload.family_name ?? '',
      photoUrl: payload.picture ?? null,
    };
  }
}
