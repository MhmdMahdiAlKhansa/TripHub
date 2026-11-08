import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Session, User } from '@triphub/database';
import type { Request } from 'express';
import { readSessionToken } from './auth.http';
import { AuthService, STEP_UP_MINUTES } from './auth.service';

export type AuthedRequest = Request & { user?: User; session?: Session; sessionToken?: string };

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const token = readSessionToken(req);
    const authed = token ? await this.auth.authenticate(token) : null;
    if (!authed || !token) throw new UnauthorizedException();
    req.user = authed.user;
    req.session = authed.session;
    req.sessionToken = token;
    return true;
  }
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): User => {
  return ctx.switchToHttp().getRequest<AuthedRequest>().user as User;
});

/** Sensitive actions need a recent re-authentication (POST /auth/step-up). Use after SessionGuard. */
@Injectable()
export class StepUpGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const s = ctx.switchToHttp().getRequest<AuthedRequest>().session;
    if (!s?.stepUpAt || Date.now() - s.stepUpAt.getTime() > STEP_UP_MINUTES * 60_000) {
      throw new ForbiddenException({ code: 'step_up_required' });
    }
    return true;
  }
}

/**
 * CSRF defence for cookie-authenticated mutations (in addition to SameSite=Lax):
 * a state-changing request carrying an Origin header must come from an allowed origin.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
    const origin = req.headers.origin;
    if (!origin) return true; // non-browser client; no ambient cookie attack possible
    const allowed = (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(',');
    if (!allowed.includes(origin)) throw new ForbiddenException('Origin not allowed');
    return true;
  }
}
