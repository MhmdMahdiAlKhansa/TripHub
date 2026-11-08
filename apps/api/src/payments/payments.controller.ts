import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { User } from '@triphub/database';
import { z } from 'zod';
import { PlatformGuard, RequirePlatformPermission } from '../admin/admin.guards';
import { CurrentUser, SessionGuard, StepUpGuard, type AuthedRequest } from '../auth/auth.guards';
import { LedgerService } from '../ledger/ledger.service';
import { RateLimit } from '../ratelimit/ratelimit';
import { PermissionGuard, RequirePermission, TenantGuard, UUID_RE, type TenantRequest } from '../tenancy/tenancy.guards';
import { PaymentsService, paymentView } from './payments.service';
import { RefundsService, refundView } from './refunds.service';

const SubmitDto = z
  .object({
    method: z.enum(['WHISH', 'OMT']),
    reference: z.string().trim().min(4).max(64).regex(/^[A-Za-z0-9._\-/]+$/).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();
const RejectDto = z.object({ reason: z.string().trim().min(10).max(500) }).strict();
const RefundReasonDto = z.object({ reason: z.string().trim().min(10).max(500) }).strict();
const PaidDto = z.object({ payoutReference: z.string().trim().min(4).max(64).regex(/^[A-Za-z0-9._\-/]+$/) }).strict();
const REFUND_STATUSES = ['REQUESTED', 'APPROVED', 'PAID', 'REJECTED'] as const;
const STATUSES = ['PROOF_SUBMITTED', 'VERIFIED', 'VERIFIED_UNALLOCATED', 'REJECTED'] as const;

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) {
    throw new BadRequestException({
      code: 'validation_error',
      issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return r.data;
}
const idOr404 = (id: string) => {
  if (!UUID_RE.test(id)) throw new NotFoundException();
  return id;
};

@ApiTags('payments')
@Controller({ path: 'bookings/:bookingId/payments', version: '1' })
@UseGuards(SessionGuard)
export class CustomerPaymentsController {
  constructor(@Inject(PaymentsService) private readonly svc: PaymentsService) {}

  /** Submits proof of a manual (Whish/OMT) transfer. This is a claim, not a confirmation. */
  @Post()
  @RateLimit({ limit: 10, windowSec: 60 })
  async submit(@CurrentUser() user: User, @Param('bookingId') bookingId: string, @Body() body: unknown) {
    const p = await this.svc.submitProof(user.id, idOr404(bookingId), parse(SubmitDto, body));
    return { payment: paymentView(p) };
  }
}

@ApiTags('refunds')
@Controller({ path: 'bookings/:bookingId/refund', version: '1' })
@UseGuards(SessionGuard)
export class CustomerRefundsController {
  constructor(@Inject(RefundsService) private readonly svc: RefundsService) {}

  @Get()
  async get(@CurrentUser() user: User, @Param('bookingId') bookingId: string) {
    const r = await this.svc.forBooking(user.id, idOr404(bookingId));
    return { refund: r ? refundView(r) : null };
  }
}

@ApiTags('company-refunds')
@Controller({ path: 'companies/:companyId/bookings/:bookingId/refund', version: '1' })
export class CompanyRefundsController {
  constructor(@Inject(RefundsService) private readonly svc: RefundsService) {}

  /** A business asks for the refund of a cancelled booking. Platform finance decides. */
  @Post()
  @RateLimit({ limit: 20, windowSec: 60 })
  @UseGuards(SessionGuard, TenantGuard, PermissionGuard)
  @RequirePermission('refund.request')
  async request(@Req() req: TenantRequest, @Param('bookingId') bookingId: string, @Body() body: unknown) {
    const r = await this.svc.requestForBooking(req.user!.id, req.membership!.companyId, idOr404(bookingId), parse(RefundReasonDto, body).reason);
    return { refund: refundView(r) };
  }
}

@ApiTags('admin-payments')
@Controller({ path: 'admin', version: '1' })
@UseGuards(SessionGuard, PlatformGuard)
export class AdminPaymentsController {
  constructor(
    @Inject(PaymentsService) private readonly svc: PaymentsService,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(RefundsService) private readonly refunds: RefundsService,
  ) {}

  @Get('refunds')
  @RequirePlatformPermission('refund.view')
  async listRefunds(@Query('status') status = 'REQUESTED') {
    if (!(REFUND_STATUSES as readonly string[]).includes(status)) throw new BadRequestException({ code: 'invalid_status' });
    const rows = await this.refunds.list(status);
    return { refunds: rows.map((r) => ({ ...refundView(r), bookingReference: r.payment.booking.reference, paymentId: r.paymentId })) };
  }

  @Post('payments/:id/refund')
  @RateLimit({ limit: 30, windowSec: 60 })
  @RequirePlatformPermission('refund.decide')
  @UseGuards(StepUpGuard)
  async openRefund(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const r = await this.refunds.requestForPayment(req.user!.id, idOr404(id), parse(RefundReasonDto, body).reason);
    return { refund: refundView(r) };
  }

  @Post('refunds/:id/approve')
  @HttpCode(200)
  @RateLimit({ limit: 60, windowSec: 60 })
  @RequirePlatformPermission('refund.decide')
  @UseGuards(StepUpGuard)
  async approveRefund(@Param('id') id: string, @Req() req: AuthedRequest) {
    return { refund: refundView(await this.refunds.approve(req.user!.id, idOr404(id))) };
  }

  @Post('refunds/:id/reject')
  @HttpCode(200)
  @RateLimit({ limit: 60, windowSec: 60 })
  @RequirePlatformPermission('refund.decide')
  @UseGuards(StepUpGuard)
  async rejectRefund(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return { refund: refundView(await this.refunds.reject(req.user!.id, idOr404(id), parse(RefundReasonDto, body).reason)) };
  }

  @Post('refunds/:id/paid')
  @HttpCode(200)
  @RateLimit({ limit: 60, windowSec: 60 })
  @RequirePlatformPermission('refund.decide')
  @UseGuards(StepUpGuard)
  async markRefundPaid(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return { refund: refundView(await this.refunds.markPaid(req.user!.id, idOr404(id), parse(PaidDto, body).payoutReference)) };
  }

  @Get('payments')
  @RequirePlatformPermission('payment.view')
  async list(@Query('status') status = 'PROOF_SUBMITTED') {
    if (!(STATUSES as readonly string[]).includes(status)) throw new BadRequestException({ code: 'invalid_status' });
    const rows = await this.svc.list(status);
    return {
      payments: rows.map((p) => ({
        ...paymentView(p),
        bookingReference: p.booking.reference,
        bookingStatus: p.booking.status,
        customerEmail: p.customer.email,
      })),
    };
  }

  @Post('payments/:id/verify')
  @HttpCode(200)
  @RateLimit({ limit: 60, windowSec: 60 })
  @RequirePlatformPermission('payment.verify')
  @UseGuards(StepUpGuard)
  async verify(@Param('id') id: string, @Req() req: AuthedRequest) {
    const p = await this.svc.verify(req.user!.id, idOr404(id));
    return { payment: paymentView(p) };
  }

  @Post('payments/:id/reject')
  @HttpCode(200)
  @RateLimit({ limit: 60, windowSec: 60 })
  @RequirePlatformPermission('payment.verify')
  @UseGuards(StepUpGuard)
  async reject(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const p = await this.svc.reject(req.user!.id, idOr404(id), parse(RejectDto, body).reason);
    return { payment: paymentView(p) };
  }

  @Get('ledger/balances')
  @RequirePlatformPermission('ledger.view')
  async balances() {
    const b = await this.ledger.balances();
    return {
      accounts: b.accounts.map((a) => ({ ...a, balanceMinor: a.balanceMinor.toString() })),
      totalsByCurrency: Object.fromEntries(Object.entries(b.totalsByCurrency).map(([k, v]) => [k, v.toString()])),
    };
  }
}
