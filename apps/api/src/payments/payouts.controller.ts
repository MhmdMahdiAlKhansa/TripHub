import { BadRequestException, Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PlatformGuard, RequirePlatformPermission } from '../admin/admin.guards';
import { SessionGuard, StepUpGuard, type AuthedRequest } from '../auth/auth.guards';
import { RateLimit } from '../ratelimit/ratelimit';
import { PermissionGuard, RequirePermission, TenantGuard, UUID_RE, type TenantRequest } from '../tenancy/tenancy.guards';
import { PayoutsService, payoutView } from './payouts.service';

const Money = z.string().regex(/^[1-9][0-9]{0,14}$/, 'positive integer minor units').transform((v) => BigInt(v));
const RequestDto = z.object({ amountMinor: Money, currency: z.enum(['USD', 'LBP']), note: z.string().trim().max(300).optional() }).strict();
const ReasonDto = z.object({ reason: z.string().trim().min(10).max(500) }).strict();
const PaidDto = z.object({ payoutReference: z.string().trim().min(4).max(64).regex(/^[A-Za-z0-9._\-/]+$/) }).strict();
const STATUSES = ['REQUESTED', 'APPROVED', 'PAID', 'REJECTED'] as const;
const CURRENCY = z.enum(['USD', 'LBP']);

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
const balanceView = (p: Awaited<ReturnType<PayoutsService['payable']>>) => ({
  owedMinor: p.owedMinor.toString(),
  heldMinor: p.heldMinor.toString(),
  earmarkedMinor: p.earmarkedMinor.toString(),
  eligibleMinor: p.eligibleMinor.toString(),
});

@ApiTags('payouts')
@Controller({ path: 'admin', version: '1' })
@UseGuards(SessionGuard, PlatformGuard)
export class AdminPayoutsController {
  constructor(@Inject(PayoutsService) private readonly svc: PayoutsService) {}

  @Get('payouts')
  @RequirePlatformPermission('payout.view')
  async list(@Query('status') status = 'REQUESTED') {
    if (!(STATUSES as readonly string[]).includes(status)) throw new BadRequestException({ code: 'invalid_status' });
    return { payouts: (await this.svc.list(status)).map(payoutView) };
  }

  @Get('companies/:id/payable')
  @RequirePlatformPermission('payout.view')
  async payable(@Param('id') id: string, @Query('currency') currency = 'USD') {
    const c = CURRENCY.safeParse(currency);
    if (!c.success) throw new BadRequestException({ code: 'invalid_currency' });
    return { currency: c.data, ...balanceView(await this.svc.payable(idOr404(id), c.data)) };
  }

  @Post('companies/:id/payouts')
  @RateLimit({ limit: 30, windowSec: 60 })
  @RequirePlatformPermission('payout.manage')
  @UseGuards(StepUpGuard)
  async request(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return { payout: payoutView(await this.svc.request(req.user!.id, idOr404(id), parse(RequestDto, body))) };
  }

  @Post('payouts/:id/approve')
  @HttpCode(200)
  @RateLimit({ limit: 60, windowSec: 60 })
  @RequirePlatformPermission('payout.manage')
  @UseGuards(StepUpGuard)
  async approve(@Param('id') id: string, @Req() req: AuthedRequest) {
    return { payout: payoutView(await this.svc.approve(req.user!.id, idOr404(id))) };
  }

  @Post('payouts/:id/reject')
  @HttpCode(200)
  @RateLimit({ limit: 60, windowSec: 60 })
  @RequirePlatformPermission('payout.manage')
  @UseGuards(StepUpGuard)
  async reject(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return { payout: payoutView(await this.svc.reject(req.user!.id, idOr404(id), parse(ReasonDto, body).reason)) };
  }

  @Post('payouts/:id/paid')
  @HttpCode(200)
  @RateLimit({ limit: 60, windowSec: 60 })
  @RequirePlatformPermission('payout.manage')
  @UseGuards(StepUpGuard)
  async paid(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return { payout: payoutView(await this.svc.markPaid(req.user!.id, idOr404(id), parse(PaidDto, body).payoutReference)) };
  }
}

@ApiTags('company-payouts')
@Controller({ path: 'companies/:companyId/payouts', version: '1' })
export class CompanyPayoutsController {
  constructor(@Inject(PayoutsService) private readonly svc: PayoutsService) {}

  /** The business sees what it is owed, what is still inside the hold window, and its payout history. */
  @Get()
  @UseGuards(SessionGuard, TenantGuard, PermissionGuard)
  @RequirePermission('billing.manage')
  async mine(@Req() req: TenantRequest) {
    const companyId = req.membership!.companyId;
    const [usd, lbp, payouts] = await Promise.all([this.svc.payable(companyId, 'USD'), this.svc.payable(companyId, 'LBP'), this.svc.forCompany(companyId)]);
    return { balances: { USD: balanceView(usd), LBP: balanceView(lbp) }, payouts: payouts.map(payoutView) };
  }
}
