import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { BOOKING_STATUSES, normalizePromoCode } from '@triphub/shared';
import { PromoService } from '../marketing/promo.service';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentUser, SessionGuard } from '../auth/auth.guards';
import { RateLimit } from '../ratelimit/ratelimit';
import { PermissionGuard, RequirePermission, TenantGuard, UUID_RE, type TenantRequest } from '../tenancy/tenancy.guards';
import type { User } from '@triphub/database';
import { AvailabilityService } from './availability.service';
import { CancelDto, CreateBookingDto, IdempotencyKey, JoinWaitlistDto, DeclineDto, QuoteDto, RatesDto, SlotDto, SlotPatchDto } from './booking.dto';
import { WaitlistService } from './waitlist.service';
import { BookingsService, bookingView, quoteOrThrow, toRateInputs } from './bookings.service';

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

const rateView = (r: { kind: string; amountMinor: bigint; currency: string; groupSize: number | null }) => ({
  kind: r.kind,
  amountMinor: r.amountMinor.toString(),
  currency: r.currency,
  groupSize: r.groupSize,
});
const slotView = (s: { id: string; startsAt: Date; endsAt: Date | null; capacity: number; reserved: number; status: string }) => ({
  id: s.id,
  startsAt: s.startsAt,
  endsAt: s.endsAt,
  capacity: s.capacity,
  reserved: s.reserved,
  remaining: Math.max(0, s.capacity - s.reserved),
  status: s.status,
});

// ------------------------------------------------------------------ business: rates & slots

@ApiTags('availability')
@Controller({ path: 'companies/:companyId/listings/:listingId', version: '1' })
export class AvailabilityController {
  constructor(@Inject(AvailabilityService) private readonly svc: AvailabilityService) {}

  @Put('rates')
  @RateLimit({ limit: 30, windowSec: 60 })
  @UseGuards(SessionGuard, TenantGuard, PermissionGuard)
  @RequirePermission('listing.write')
  async setRates(@Req() req: TenantRequest, @Param('listingId') listingId: string, @Body() body: unknown) {
    const rates = await this.svc.setRates(req.membership!.companyId, idOr404(listingId), req.user!.id, parse(RatesDto, body));
    return { rates: rates.map(rateView) };
  }

  @Get('rates')
  @UseGuards(SessionGuard, TenantGuard, PermissionGuard)
  @RequirePermission('company.view')
  async rates(@Req() req: TenantRequest, @Param('listingId') listingId: string) {
    return { rates: (await this.svc.getRates(req.membership!.companyId, idOr404(listingId))).map(rateView) };
  }

  @Post('slots')
  @RateLimit({ limit: 60, windowSec: 60 })
  @UseGuards(SessionGuard, TenantGuard, PermissionGuard)
  @RequirePermission('listing.write')
  async createSlot(@Req() req: TenantRequest, @Param('listingId') listingId: string, @Body() body: unknown) {
    const s = await this.svc.createSlot(req.membership!.companyId, idOr404(listingId), req.user!.id, parse(SlotDto, body));
    return { slot: slotView(s) };
  }

  @Get('slots')
  @UseGuards(SessionGuard, TenantGuard, PermissionGuard)
  @RequirePermission('company.view')
  async slots(@Req() req: TenantRequest, @Param('listingId') listingId: string) {
    return { slots: (await this.svc.listSlots(req.membership!.companyId, idOr404(listingId))).map(slotView) };
  }

  @Patch('slots/:slotId')
  @RateLimit({ limit: 60, windowSec: 60 })
  @UseGuards(SessionGuard, TenantGuard, PermissionGuard)
  @RequirePermission('listing.write')
  async patchSlot(
    @Req() req: TenantRequest,
    @Param('listingId') listingId: string,
    @Param('slotId') slotId: string,
    @Body() body: unknown,
  ) {
    const s = await this.svc.updateSlot(req.membership!.companyId, idOr404(listingId), idOr404(slotId), req.user!.id, parse(SlotPatchDto, body));
    return { slot: slotView(s) };
  }
}

// ------------------------------------------------------------------ public: availability & quote

@ApiTags('public')
@Controller({ path: 'public/listings/:id', version: '1' })
export class PublicAvailabilityController {
  constructor(
    @Inject(AvailabilityService) private readonly svc: AvailabilityService,
    @Inject(PromoService) private readonly promos: PromoService,
  ) {}

  @Get('availability')
  @RateLimit({ limit: 120, windowSec: 60 })
  async availability(@Param('id') id: string) {
    const { listing, slots } = await this.svc.publicAvailability(idOr404(id));
    return { rates: listing.rates.map(rateView), slots: slots.map(slotView) };
  }

  @Post('quote')
  @HttpCode(200)
  @RateLimit({ limit: 60, windowSec: 60 })
  async quote(@Param('id') id: string, @Body() body: unknown) {
    const dto = parse(QuoteDto, body);
    const listing = await this.svc.publicBookableListing(idOr404(id));
    const q = quoteOrThrow(toRateInputs(listing.rates), dto.lines);
    let discountMinor = 0n;
    if (dto.promoCode) {
      // Preview only: the per-customer limit is enforced when the booking is made.
      const r = await this.promos.resolve({ companyId: listing.companyId, listingId: listing.id, code: normalizePromoCode(dto.promoCode), customerId: null, totalMinor: q.totalMinor, currency: q.currency });
      discountMinor = r.discountMinor;
    }
    return {
      currency: q.currency,
      seats: q.seats,
      free: q.totalMinor - discountMinor === 0n,
      grossMinor: q.totalMinor.toString(),
      discountMinor: discountMinor.toString(),
      totalMinor: (q.totalMinor - discountMinor).toString(),
      lines: q.lines.map((l) => ({
        kind: l.kind,
        unitMinor: l.unitMinor.toString(),
        qty: l.qty,
        seats: l.seats,
        subtotalMinor: l.subtotalMinor.toString(),
      })),
    };
  }
}

// ------------------------------------------------------------------ customer bookings

@ApiTags('bookings')
@Controller({ path: 'bookings', version: '1' })
@UseGuards(SessionGuard)
export class BookingsController {
  constructor(@Inject(BookingsService) private readonly svc: BookingsService) {}

  @Post()
  @RateLimit({ limit: 20, windowSec: 60 })
  async create(
    @CurrentUser() user: User,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const k = IdempotencyKey.safeParse(key);
    if (!k.success) throw new BadRequestException({ code: 'idempotency_key_required' });
    const { booking, replay } = await this.svc.create(user.id, k.data, parse(CreateBookingDto, body));
    res.status(replay ? 200 : 201);
    if (replay) res.setHeader('Idempotent-Replay', 'true');
    return { booking: bookingView(booking) };
  }

  @Get()
  async mine(@CurrentUser() user: User) {
    return { bookings: (await this.svc.listOwn(user.id)).map(bookingView) };
  }

  @Get(':id')
  async get(@CurrentUser() user: User, @Param('id') id: string) {
    return { booking: bookingView(await this.svc.getOwn(user.id, idOr404(id))) };
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RateLimit({ limit: 20, windowSec: 60 })
  async cancel(@CurrentUser() user: User, @Param('id') id: string, @Body() body: unknown) {
    const dto = parse(CancelDto, body ?? {});
    return { booking: bookingView(await this.svc.cancel({ id: idOr404(id), customerId: user.id }, user.id, dto.reason)) };
  }
}

@ApiTags('waitlist')
@Controller({ path: 'waitlist', version: '1' })
@UseGuards(SessionGuard)
export class WaitlistController {
  constructor(@Inject(WaitlistService) private readonly svc: WaitlistService) {}

  @Post()
  @RateLimit({ limit: 20, windowSec: 60 })
  async join(@CurrentUser() user: User, @Body() body: unknown) {
    const dto = parse(JoinWaitlistDto, body);
    return { entry: await this.svc.join(user.id, dto.slotId, dto.seats) };
  }

  @Get()
  async mine(@CurrentUser() user: User) {
    return { entries: await this.svc.mine(user.id) };
  }

  @Delete(':id')
  @HttpCode(204)
  async leave(@CurrentUser() user: User, @Param('id') id: string) {
    await this.svc.leave(user.id, idOr404(id));
  }
}

// ------------------------------------------------------------------ business bookings

@ApiTags('company-bookings')
@Controller({ path: 'companies/:companyId/bookings', version: '1' })
export class CompanyBookingsController {
  constructor(@Inject(BookingsService) private readonly svc: BookingsService) {}

  @Get()
  @UseGuards(SessionGuard, TenantGuard, PermissionGuard)
  @RequirePermission('booking.view')
  async list(@Req() req: TenantRequest, @Query('status') status?: string) {
    if (status && !(BOOKING_STATUSES as readonly string[]).includes(status)) throw new BadRequestException({ code: 'invalid_status' });
    const rows = await this.svc.listForCompany(req.membership!.companyId, status);
    return { bookings: rows.map((b) => ({ ...bookingView(b), customerEmail: b.customer.email, contactName: b.contactName, contactPhone: b.contactPhone })) };
  }

  @Get(':bookingId')
  @UseGuards(SessionGuard, TenantGuard, PermissionGuard)
  @RequirePermission('booking.view')
  async get(@Req() req: TenantRequest, @Param('bookingId') bookingId: string) {
    const b = await this.svc.getForCompany(req.membership!.companyId, idOr404(bookingId));
    return { booking: { ...bookingView(b), customerEmail: b.customer.email, contactName: b.contactName, contactPhone: b.contactPhone } };
  }

  @Post(':bookingId/cancel')
  @HttpCode(200)
  @RateLimit({ limit: 30, windowSec: 60 })
  @UseGuards(SessionGuard, TenantGuard, PermissionGuard)
  @RequirePermission('booking.manage')
  async cancel(@Req() req: TenantRequest, @Param('bookingId') bookingId: string, @Body() body: unknown) {
    const dto = parse(CancelDto, body ?? {});
    const b = await this.svc.cancel({ id: idOr404(bookingId), companyId: req.membership!.companyId }, req.user!.id, dto.reason);
    return { booking: bookingView(b) };
  }

  @Post(':bookingId/approve')
  @HttpCode(200)
  @RateLimit({ limit: 60, windowSec: 60 })
  @UseGuards(SessionGuard, TenantGuard, PermissionGuard)
  @RequirePermission('booking.manage')
  async approve(@Req() req: TenantRequest, @Param('bookingId') bookingId: string) {
    return { booking: bookingView(await this.svc.approve(req.membership!.companyId, idOr404(bookingId), req.user!.id)) };
  }

  @Post(':bookingId/complete')
  @HttpCode(200)
  @RateLimit({ limit: 60, windowSec: 60 })
  @UseGuards(SessionGuard, TenantGuard, PermissionGuard)
  @RequirePermission('booking.manage')
  async complete(@Req() req: TenantRequest, @Param('bookingId') bookingId: string) {
    return { booking: bookingView(await this.svc.complete(req.membership!.companyId, idOr404(bookingId), req.user!.id)) };
  }

  @Post(':bookingId/decline')
  @HttpCode(200)
  @RateLimit({ limit: 60, windowSec: 60 })
  @UseGuards(SessionGuard, TenantGuard, PermissionGuard)
  @RequirePermission('booking.manage')
  async decline(@Req() req: TenantRequest, @Param('bookingId') bookingId: string, @Body() body: unknown) {
    const dto = parse(DeclineDto, body ?? {});
    return { booking: bookingView(await this.svc.decline(req.membership!.companyId, idOr404(bookingId), req.user!.id, dto.reason)) };
  }
}
