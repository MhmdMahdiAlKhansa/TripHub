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
import type { CompanyStatus } from '@triphub/database';
import { z } from 'zod';
import { SessionGuard, StepUpGuard, type AuthedRequest } from '../auth/auth.guards';
import { publicProfile } from '../companies/companies.service';
import { RateLimit } from '../ratelimit/ratelimit';
import { UUID_RE } from '../tenancy/tenancy.guards';
import { PlatformGuard, RequirePlatformPermission } from './admin.guards';
import { AdminService } from './admin.service';

const STATUSES = ['DRAFT', 'PENDING_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'SUSPENDED'] as const;
const ReviewDto = z
  .object({
    decision: z.enum(['APPROVED', 'CHANGES_REQUESTED', 'REJECTED']),
    reason: z.string().trim().min(10).max(1000).optional(),
  })
  .refine((v) => v.decision === 'APPROVED' || !!v.reason, {
    message: 'a reason is required unless approving',
    path: ['reason'],
  });

const idOr404 = (id: string) => {
  if (!UUID_RE.test(id)) throw new NotFoundException();
  return id;
};

@ApiTags('admin')
@Controller({ path: 'admin/companies', version: '1' })
@UseGuards(SessionGuard, PlatformGuard)
export class AdminController {
  constructor(@Inject(AdminService) private readonly svc: AdminService) {}

  @Get()
  @RequirePlatformPermission('company.review.view')
  async list(@Query('status') status = 'PENDING_REVIEW') {
    if (!(STATUSES as readonly string[]).includes(status)) throw new BadRequestException({ code: 'invalid_status' });
    return { companies: await this.svc.listCompanies(status as CompanyStatus) };
  }

  @Get(':id')
  @RequirePlatformPermission('company.review.view')
  async get(@Param('id') id: string) {
    const c = await this.svc.getCompany(idOr404(id));
    return {
      company: publicProfile(c),
      reviews: c.reviews.map((r) => ({ decision: r.decision, reason: r.reason, at: r.createdAt })),
    };
  }

  @Post(':id/review')
  @HttpCode(200)
  @RateLimit({ limit: 30, windowSec: 60 })
  @RequirePlatformPermission('company.review')
  @UseGuards(StepUpGuard)
  async review(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const parsed = ReviewDto.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'validation_error',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const c = await this.svc.review(idOr404(id), req.user!.id, parsed.data.decision, parsed.data.reason);
    return { company: publicProfile(c) };
  }
}
