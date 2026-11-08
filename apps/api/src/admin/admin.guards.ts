import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { platformCan, type PlatformPermission, type PlatformRole } from '@triphub/shared';
import type { AuthedRequest } from '../auth/auth.guards';

const KEY = 'triphub:platform-permission';
/** Every route behind PlatformGuard MUST declare a platform permission; routes without one are denied. */
export const RequirePlatformPermission = (p: PlatformPermission) => SetMetadata(KEY, p);

/**
 * Platform staff only. Ordinary users get 404 so the admin surface is not discoverable.
 * Staff sessions must have passed MFA at login (sensitive-role requirement).
 */
@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const role = (req.user?.platformRole ?? 'NONE') as PlatformRole;
    if (role === 'NONE') throw new NotFoundException();
    if (!req.session?.mfaVerifiedAt) throw new ForbiddenException({ code: 'mfa_required_for_staff' });
    const required = this.reflector.getAllAndOverride<PlatformPermission | undefined>(KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || !platformCan(role, required)) throw new ForbiddenException();
    return true;
  }
}
