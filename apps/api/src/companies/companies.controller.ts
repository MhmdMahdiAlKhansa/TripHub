import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SessionGuard } from '../auth/auth.guards';
import { RateLimit } from '../ratelimit/ratelimit';
import { PermissionGuard, RequirePermission, TenantGuard, type TenantRequest } from '../tenancy/tenancy.guards';
import { CompaniesService, publicProfile } from './companies.service';
import { ProfileDto } from './profile';

@ApiTags('company-profile')
@Controller({ path: 'companies/:companyId', version: '1' })
export class CompaniesController {
  constructor(@Inject(CompaniesService) private readonly svc: CompaniesService) {}

  @Get('profile')
  @UseGuards(SessionGuard, TenantGuard, PermissionGuard)
  @RequirePermission('company.view')
  async get(@Req() req: TenantRequest) {
    return { company: publicProfile(await this.svc.getProfile(req.membership!.companyId)) };
  }

  @Patch('profile')
  @RateLimit({ limit: 60, windowSec: 60 })
  @UseGuards(SessionGuard, TenantGuard, PermissionGuard)
  @RequirePermission('company.profile.edit')
  async update(@Req() req: TenantRequest, @Body() body: unknown) {
    const parsed = ProfileDto.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'validation_error',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const c = await this.svc.updateProfile(req.membership!.companyId, req.user!.id, parsed.data);
    return { company: publicProfile(c) };
  }

  /** Submitting for verification is an ownership decision, so it needs team.manage. */
  @Post('submit')
  @HttpCode(200)
  @RateLimit({ limit: 10, windowSec: 60 })
  @UseGuards(SessionGuard, TenantGuard, PermissionGuard)
  @RequirePermission('team.manage')
  async submit(@Req() req: TenantRequest) {
    return { company: publicProfile(await this.svc.submit(req.membership!.companyId, req.user!.id)) };
  }
}
