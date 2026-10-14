import { Body, Controller, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { User } from '@prisma/client';
import { Request, Response } from 'express';
import { AuthService, IssuedTokens } from './auth.service';
import { Public } from './decorators/public.decorator';

export const REFRESH_COOKIE = 'alumbra_rt';
const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

@Public()
@UseGuards(ThrottlerGuard)
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: FIFTEEN_MINUTES_MS } })
  async login(@Body() body: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const session = await this.authService.login(body, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });
    this.sendSession(res, session);
  }

  // Más holgado que /login: quien todavía no tiene acceso lo llama dos veces
  // (entrar y luego completar su solicitud), y el token de Google ya prueba
  // que no es alguien adivinando contraseñas.
  @Post('google')
  @HttpCode(200)
  @Throttle({ default: { limit: 15, ttl: FIFTEEN_MINUTES_MS } })
  async google(@Body() body: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const session = await this.authService.loginWithGoogle(body, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });
    this.sendSession(res, session);
  }

  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: FIFTEEN_MINUTES_MS } })
  async refresh(@Req() req: Request, @Res() res: Response): Promise<void> {
    try {
      const { accessToken, accessTokenExpiresAt, refreshToken } = await this.authService.refresh(
        this.readRefreshCookie(req),
        { userAgent: req.headers['user-agent'], ipAddress: req.ip },
      );
      this.setRefreshCookie(res, refreshToken);
      res.json({ accessToken, accessTokenExpiresAt });
    } catch (e) {
      this.clearRefreshCookie(res);
      throw e;
    }
  }

  @Post('logout')
  @HttpCode(200)
  @SkipThrottle()
  async logout(@Req() req: Request, @Res() res: Response): Promise<void> {
    await this.authService.logout(this.readRefreshCookie(req));
    this.clearRefreshCookie(res);
    res.json({ ok: true });
  }

  private sendSession(res: Response, session: IssuedTokens & { user: User }): void {
    const { accessToken, accessTokenExpiresAt, refreshToken, user } = session;
    this.setRefreshCookie(res, refreshToken);
    res.json({
      accessToken,
      accessTokenExpiresAt,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        baseRole: user.baseRole,
        isPastor: user.isPastor,
        isLeader: user.isLeader,
        photoUrl: user.photoUrl,
      },
    });
  }

  private readRefreshCookie(req: Request): string | undefined {
    return (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
  }

  private setRefreshCookie(res: Response, token: string): void {
    res.cookie(REFRESH_COOKIE, token, {
      ...this.cookieOptions(),
      maxAge: this.authService.refreshTtlDays * 24 * 3600 * 1000,
    });
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
  }

  private cookieOptions() {
    const domain = this.config.get<string>('COOKIE_DOMAIN');
    return {
      httpOnly: true,
      secure: this.config.get<string>('NODE_ENV') === 'production',
      sameSite: 'lax' as const,
      // Only sent to /auth/* — the access token travels via Authorization header.
      path: '/auth',
      ...(domain ? { domain } : {}),
    };
  }
}
