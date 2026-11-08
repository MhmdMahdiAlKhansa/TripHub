import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { normalizePromoCode, PROMO_CODE_RE } from '@triphub/shared';
import { z } from 'zod';
import { SessionGuard } from '../auth/auth.guards';
import { RateLimit } from '../ratelimit/ratelimit';
import { PermissionGuard, RequirePermission, TenantGuard, UUID_RE, type TenantRequest } from '../tenancy/tenancy.guards';
import { promoView, PromoService } from './promo.service';

const code = z.string().transform(normalizePromoCode).pipe(z.string().regex(PROMO_CODE_RE));
const Money = z.string().regex(/^[1-9][0-9]{0,14}$/).transform((v) => BigInt(v));
const CreateDto = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('PERCENT'), percentBps: z.number().int().min(1).max(10_000) }),
    z.object({ kind: z.literal('FIXED'), amountMinor: Money, currency: z.enum(['USD', 'LBP']) }),
  ])
  .and(
    z.object({
      code,
      listingId: z.uuid().optional(),
      validFrom: z.coerce.date().optional(),
      validTo: z.coerce.date().optional(),
      maxRedemptions: z.number().int().min(1).max(100_000).optional(),
    }),
  )
  .refine((v) => !v.validFrom || !v.validTo || v.validFrom < v.validTo, 'validFrom must be before validTo');
const ActiveDto = z.object({ active: z.boolean() }).strict();

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new BadRequestException({ code: 'validation_error', issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
  return r.data;
}

@ApiTags('promo-codes')
@Controller({ path: 'companies/:companyId/promo-codes', version: '1' })
export class PromoController {
  constructor(@Inject(PromoService) private readonly svc: PromoService) {}

  @Post()
  @RateLimit({ limit: 30, windowSec: 60 })
  @UseGuards(SessionGuard, TenantGuard, PermissionGuard)
  @RequirePermission('listing.publish')
  async create(@Req() req: TenantRequest, @Body() body: unknown) {
    const dto = parse(CreateDto, body);
    return { promo: promoView(await this.svc.create(req.membership!.companyId, req.user!.id, dto)) };
  }

  @Get()
  @UseGuards(SessionGuard, TenantGuard, PermissionGuard)
  @RequirePermission('listing.publish')
  async list(@Req() req: TenantRequest) {
    return { promos: (await this.svc.list(req.membership!.companyId)).map(promoView) };
  }

  @Patch(':id')
  @UseGuards(SessionGuard, TenantGuard, PermissionGuard)
  @RequirePermission('listing.publish')
  async toggle(@Req() req: TenantRequest, @Param('id') id: string, @Body() body: unknown) {
    if (!UUID_RE.test(id)) throw new NotFoundException();
    return { promo: promoView(await this.svc.setActive(req.membership!.companyId, req.user!.id, id, parse(ActiveDto, body).active)) };
  }
}
