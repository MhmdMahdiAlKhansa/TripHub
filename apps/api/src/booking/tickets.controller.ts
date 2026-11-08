import { BadRequestException, Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { User } from '@triphub/database';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentUser, SessionGuard } from '../auth/auth.guards';
import { RateLimit } from '../ratelimit/ratelimit';
import { PermissionGuard, RequirePermission, TenantGuard, UUID_RE, type TenantRequest } from '../tenancy/tenancy.guards';
import { TicketsService } from './tickets.service';

const CheckInDto = z.object({ code: z.string().trim().min(10).max(80) }).strict();
const idOr404 = (id: string) => {
  if (!UUID_RE.test(id)) throw new NotFoundException();
  return id;
};

@ApiTags('tickets')
@Controller({ path: 'bookings/:bookingId', version: '1' })
@UseGuards(SessionGuard)
export class CustomerTicketsController {
  constructor(@Inject(TicketsService) private readonly svc: TicketsService) {}

  @Get('ticket')
  async ticket(@CurrentUser() user: User, @Param('bookingId') id: string) {
    return { ticket: await this.svc.ticketFor(user.id, idOr404(id)) };
  }

  @Get('calendar.ics')
  async calendar(@CurrentUser() user: User, @Param('bookingId') id: string, @Res() res: Response) {
    const ics = await this.svc.calendarFor(user.id, idOr404(id));
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="booking.ics"');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(ics);
  }
}

@ApiTags('company-check-in')
@Controller({ path: 'companies/:companyId', version: '1' })
export class CompanyTicketsController {
  constructor(@Inject(TicketsService) private readonly svc: TicketsService) {}

  @Post('check-in')
  @HttpCode(200)
  @RateLimit({ limit: 120, windowSec: 60 })
  @UseGuards(SessionGuard, TenantGuard, PermissionGuard)
  @RequirePermission('booking.checkin')
  async checkIn(@Req() req: TenantRequest, @Body() body: unknown) {
    const r = CheckInDto.safeParse(body);
    if (!r.success) throw new BadRequestException({ code: 'validation_error' });
    return { checkedIn: await this.svc.checkIn(req.membership!.companyId, req.user!.id, r.data.code) };
  }

  @Get('bookings-export.csv')
  @RateLimit({ limit: 10, windowSec: 60 })
  @UseGuards(SessionGuard, TenantGuard, PermissionGuard)
  @RequirePermission('booking.view')
  async exportCsv(@Req() req: TenantRequest, @Res() res: Response) {
    const csv = await this.svc.exportCsv(req.membership!.companyId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="bookings.csv"');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(csv);
  }
}
