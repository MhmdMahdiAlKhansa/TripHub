import { BadRequestException, Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ADD_ON_KINDS, SELF_SERVE_PLANS } from '@triphub/shared';
import { z } from 'zod';
import { PlatformGuard, RequirePlatformPermission } from '../admin/admin.guards';
import { SessionGuard, StepUpGuard, type AuthedRequest } from '../auth/auth.guards';
import { RateLimit } from '../ratelimit/ratelimit';
import { PermissionGuard, RequirePermission, TenantGuard, UUID_RE, type TenantRequest } from '../tenancy/tenancy.guards';
import { SubscriptionsService } from './subscriptions.service';

const TrialDto = z.object({ acknowledgedCommissionBps: z.number().int().min(0).max(10_000) }).strict();
const addOns = z.object(Object.fromEntries(ADD_ON_KINDS.map((k) => [k, z.number().int().min(0).max(100).optional()]))).strict();
const RequestDto = z
  .object({
    plan: z.enum(SELF_SERVE_PLANS as unknown as [string, ...string[]]),
    cycle: z.enum(['MONTHLY', 'ANNUAL']),
    addOns: addOns.default({}),
  })
  .strict();
const FulfilDto = z
  .object({
    method: z.enum(['WHISH', 'OMT', 'BANK']),
    reference: z.string().trim().min(4).max(64).regex(/^[A-Za-z0-9._\-/]+$/),
  })
  .strict();

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) {
    throw new BadRequestException({ code: 'validation_error', issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
  }
  return r.data;
}
const idOr404 = (id: string) => {
  if (!UUID_RE.test(id)) throw new NotFoundException();
  return id;
};
const invoiceView = (i: Awaited<ReturnType<SubscriptionsService['invoices']>>[number]) => ({
  id: i.id,
  number: i.number,
  plan: i.planCode,
  cycle: i.cycle,
  periodStart: i.periodStart,
  periodEnd: i.periodEnd,
  amountMinor: i.amountMinor.toString(),
  currency: i.currency,
  paymentMethod: i.paymentMethod,
  paymentReference: i.paymentReference,
  lines: i.lines,
  createdAt: i.createdAt,
});

@ApiTags('plans')
@Controller({ path: 'plans', version: '1' })
export class PlansController {
  constructor(@Inject(SubscriptionsService) private readonly svc: SubscriptionsService) {}

  /** Public price list. Prices shown here are exactly what a new contract is sold at today. */
  @Get()
  async list() {
    return { plans: await this.svc.catalog() };
  }
}

@ApiTags('subscription')
@Controller({ path: 'companies/:companyId/subscription', version: '1' })
export class CompanySubscriptionController {
  constructor(@Inject(SubscriptionsService) private readonly svc: SubscriptionsService) {}

  @Get()
  @UseGuards(SessionGuard, TenantGuard, PermissionGuard)
  @RequirePermission('company.view')
  overview(@Req() req: TenantRequest) {
    return this.svc.overview(req.membership!.companyId);
  }

  @Post('trial')
  @HttpCode(200)
  @RateLimit({ limit: 10, windowSec: 60 })
  @UseGuards(SessionGuard, TenantGuard, PermissionGuard)
  @RequirePermission('billing.manage')
  trial(@Req() req: TenantRequest, @Body() body: unknown) {
    return this.svc.startTrial(req.membership!.companyId, req.user!.id, parse(TrialDto, body).acknowledgedCommissionBps);
  }

  @Post('request')
  @HttpCode(200)
  @RateLimit({ limit: 10, windowSec: 60 })
  @UseGuards(SessionGuard, TenantGuard, PermissionGuard)
  @RequirePermission('billing.manage')
  request(@Req() req: TenantRequest, @Body() body: unknown) {
    const dto = parse(RequestDto, body);
    return this.svc.requestPlan(req.membership!.companyId, req.user!.id, { plan: dto.plan as never, cycle: dto.cycle, addOns: dto.addOns });
  }

  @Post('cancel')
  @HttpCode(200)
  @RateLimit({ limit: 10, windowSec: 60 })
  @UseGuards(SessionGuard, TenantGuard, PermissionGuard)
  @RequirePermission('billing.manage')
  cancel(@Req() req: TenantRequest) {
    return this.svc.cancel(req.membership!.companyId, req.user!.id);
  }

  @Get('invoices')
  @UseGuards(SessionGuard, TenantGuard, PermissionGuard)
  @RequirePermission('billing.manage')
  async invoices(@Req() req: TenantRequest) {
    return { invoices: (await this.svc.invoices(req.membership!.companyId)).map(invoiceView) };
  }
}

@ApiTags('admin-subscriptions')
@Controller({ path: 'admin/subscription-requests', version: '1' })
@UseGuards(SessionGuard, PlatformGuard)
export class AdminSubscriptionsController {
  constructor(@Inject(SubscriptionsService) private readonly svc: SubscriptionsService) {}

  @Get()
  @RequirePlatformPermission('subscription.view')
  async list() {
    const rows = await this.svc.listOpenRequests();
    return {
      requests: rows.map((r) => ({ id: r.id, company: r.company, plan: r.planCode, cycle: r.cycle, addOns: r.addOns, createdAt: r.createdAt })),
    };
  }

  @Get(':id/quote')
  @RequirePlatformPermission('subscription.view')
  async quote(@Param('id') id: string) {
    const q = await this.svc.quoteRequest(idOr404(id));
    return { amountMinor: q.amountMinor.toString(), currency: 'USD', plan: q.r.planCode, cycle: q.r.cycle, commissionBps: q.price.commissionBps };
  }

  @Post(':id/fulfil')
  @HttpCode(200)
  @RateLimit({ limit: 30, windowSec: 60 })
  @RequirePlatformPermission('subscription.manage')
  @UseGuards(StepUpGuard)
  async fulfil(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return { invoice: invoiceView(await this.svc.fulfil(req.user!.id, idOr404(id), parse(FulfilDto, body))) };
  }
}
