import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { can, type Permission } from '@triphub/shared';
import type { Membership, PrismaClient } from '@triphub/database';
import { PRISMA } from '../database/database.module';
import type { AuthedRequest } from '../auth/auth.guards';

export type TenantRequest = AuthedRequest & { membership?: Membership };

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PERMISSION_KEY ='triphub:permission';
/** Every route behind TenantGuard MUST declare a permission; routes without one are denied. */
export const RequirePermission = (p: Permission) => SetMetadata(PERMISSION_KEY, p);

/**
 * Resolves the caller's ACTIVE membership for :companyId from the database.
 * The company id in the URL is never trusted by itself. A non-member gets 404, identical
 * to a company that does not exist, so tenants cannot probe each other's existence.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<TenantRequest>();
    const companyId = String(req.params.companyId ?? '');
    if (!req.user || !UUID_RE.test(companyId)) throw new NotFoundException();
    const membership = await this.db.membership.findFirst({
      where: { companyId, userId: req.user.id, status: 'ACTIVE' },
    });
    if (!membership) throw new NotFoundException();
    req.membership = membership;
    return true;
  }
}

/** Deny by default: no declared permission, or a role lacking it, means 403. */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission | undefined>(PERMISSION_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    const m = ctx.switchToHttp().getRequest<TenantRequest>().membership;
    if (!required || !m || !can(m.role, required)) throw new ForbiddenException();
    return true;
  }
}
