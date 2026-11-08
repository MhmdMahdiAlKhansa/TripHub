import { BadRequestException, Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PlatformGuard, RequirePlatformPermission } from '../admin/admin.guards';
import { SessionGuard, StepUpGuard, type AuthedRequest } from '../auth/auth.guards';
import { RateLimit } from '../ratelimit/ratelimit';
import { UUID_RE } from '../tenancy/tenancy.guards';
import { ContentService } from './content.service';

const FeatureDto = z.object({ featured: z.boolean() }).strict();
const RateDto = z.object({ lbpPerUsd: z.number().int().min(1000).max(10_000_000), source: z.string().trim().min(3).max(200) }).strict();

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new BadRequestException({ code: 'validation_error', issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
  return r.data;
}

@ApiTags('public')
@Controller({ path: 'public/fx', version: '1' })
export class PublicFxController {
  constructor(@Inject(ContentService) private readonly svc: ContentService) {}

  /** Indicative only: shown next to USD prices; bookings and payments stay in the listing's own currency. */
  @Get()
  @RateLimit({ limit: 120, windowSec: 60 })
  async get() {
    const r = await this.svc.currentRate();
    return { rate: r ? { lbpPerUsd: r.lbpPerUsd, source: r.source, effectiveFrom: r.effectiveFrom } : null, indicative: true };
  }
}

@ApiTags('admin-content')
@Controller({ path: 'admin', version: '1' })
@UseGuards(SessionGuard, PlatformGuard)
export class AdminContentController {
  constructor(@Inject(ContentService) private readonly svc: ContentService) {}

  @Post('listings/:id/feature')
  @HttpCode(200)
  @RateLimit({ limit: 60, windowSec: 60 })
  @RequirePlatformPermission('content.manage')
  async feature(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    if (!UUID_RE.test(id)) throw new NotFoundException();
    const l = await this.svc.setFeatured(req.user!.id, id, parse(FeatureDto, body).featured);
    return { listing: { id: l.id, featured: l.featuredAt !== null } };
  }

  @Get('fx')
  @RequirePlatformPermission('fx.manage')
  async history() {
    return { rates: (await this.svc.history()).map((r) => ({ id: r.id, lbpPerUsd: r.lbpPerUsd, source: r.source, effectiveFrom: r.effectiveFrom })) };
  }

  @Post('fx')
  @RateLimit({ limit: 20, windowSec: 60 })
  @RequirePlatformPermission('fx.manage')
  @UseGuards(StepUpGuard)
  async setRate(@Body() body: unknown, @Req() req: AuthedRequest) {
    const dto = parse(RateDto, body);
    const r = await this.svc.setRate(req.user!.id, dto.lbpPerUsd, dto.source);
    return { rate: { id: r.id, lbpPerUsd: r.lbpPerUsd, source: r.source, effectiveFrom: r.effectiveFrom } };
  }
}
