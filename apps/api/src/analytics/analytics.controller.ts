import { BadRequestException, Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SessionGuard } from '../auth/auth.guards';
import { RateLimit } from '../ratelimit/ratelimit';
import { PermissionGuard, RequirePermission, TenantGuard, type TenantRequest } from '../tenancy/tenancy.guards';
import { AnalyticsService, parseRange } from './analytics.service';

@ApiTags('analytics')
@Controller({ path: 'companies/:companyId/analytics', version: '1' })
export class AnalyticsController {
  constructor(@Inject(AnalyticsService) private readonly svc: AnalyticsService) {}

  /** Defaults to the last 30 days; at most 366 days. Advanced breakdowns depend on the plan. */
  @Get()
  @RateLimit({ limit: 30, windowSec: 60 })
  @UseGuards(SessionGuard, TenantGuard, PermissionGuard)
  @RequirePermission('billing.manage')
  async summary(@Req() req: TenantRequest, @Query('from') from?: string, @Query('to') to?: string) {
    const range = parseRange(from, to);
    if (!range) throw new BadRequestException({ code: 'invalid_range', maxDays: 366 });
    return this.svc.summary(req.membership!.companyId, range.from, range.to);
  }
}
