import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { COMPANY_ROLES } from '@triphub/shared';
import type { User } from '@triphub/database';
import { z } from 'zod';
import { CurrentUser, SessionGuard, StepUpGuard, type AuthedRequest } from '../auth/auth.guards';
import { RateLimit } from '../ratelimit/ratelimit';
import { InvalidInvitationError, TenancyService } from './tenancy.service';
import {
  PermissionGuard,
  RequirePermission,
  TenantGuard,
  UUID_RE,
  type TenantRequest,
} from './tenancy.guards';

const role = z.enum(COMPANY_ROLES);
const CreateCompanyDto = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(50)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
});
const InviteDto = z.object({ email: z.string().trim().toLowerCase().max(254).pipe(z.email()), role });
const RoleDto = z.object({ role });
const TokenDto = z.object({ token: z.string().min(20).max(200) });

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
const memberIdOr404 = (id: string) => {
  if (!UUID_RE.test(id)) throw new NotFoundException();
  return id;
};

@ApiTags('companies')
@Controller({ version: '1' })
export class TenancyController {
  constructor(@Inject(TenancyService) private readonly svc: TenancyService) {}

  @Post('companies')
  @UseGuards(SessionGuard)
  async create(@CurrentUser() user: User, @Body() body: unknown) {
    const dto = parse(CreateCompanyDto, body);
    const c = await this.svc.createCompany(user, dto.name, dto.slug);
    return { company: { id: c.id, slug: c.slug, name: c.name, status: c.status } };
  }

  @Get('companies')
  @UseGuards(SessionGuard)
  async mine(@CurrentUser() user: User) {
    const rows = await this.svc.listMine(user.id);
    return {
      companies: rows.map((m) => ({
        id: m.company.id,
        slug: m.company.slug,
        name: m.company.name,
        status: m.company.status,
        role: m.role,
      })),
    };
  }

  @Post('invitations/accept')
  @RateLimit({ limit: 10, windowSec: 60 })
  @HttpCode(200)
  @UseGuards(SessionGuard)
  async accept(@CurrentUser() user: User, @Body() body: unknown) {
    const dto = parse(TokenDto, body);
    try {
      const m = await this.svc.acceptInvitation(user, dto.token);
      return { companyId: m.companyId, role: m.role };
    } catch (e) {
      if (e instanceof InvalidInvitationError) {
        throw new BadRequestException({ code: 'invalid_or_expired_invitation' });
      }
      throw e;
    }
  }

  @Get('companies/:companyId')
  @UseGuards(SessionGuard, TenantGuard, PermissionGuard)
  @RequirePermission('company.view')
  async get(@Req() req: TenantRequest) {
    const c = await this.svc.getCompany(req.membership!.companyId);
    return { company: { id: c.id, slug: c.slug, name: c.name, status: c.status }, role: req.membership!.role };
  }

  @Get('companies/:companyId/members')
  @UseGuards(SessionGuard, TenantGuard, PermissionGuard)
  @RequirePermission('team.view')
  async members(@Req() req: TenantRequest) {
    const rows = await this.svc.listMembers(req.membership!.companyId);
    return {
      members: rows.map((m) => ({
        id: m.id,
        role: m.role,
        user: { id: m.user.id, email: m.user.email, displayName: m.user.displayName },
      })),
    };
  }

  @Post('companies/:companyId/invitations')
  @RateLimit({ limit: 20, windowSec: 60 })
  @HttpCode(202)
  @UseGuards(SessionGuard, TenantGuard, PermissionGuard)
  @RequirePermission('team.manage')
  async invite(@Req() req: TenantRequest, @Body() body: unknown) {
    const dto = parse(InviteDto, body);
    await this.svc.invite(req.membership!.companyId, req.user!.id, dto.email, dto.role);
    return { status: 'invitation_sent' };
  }

  @Patch('companies/:companyId/members/:memberId')
  @UseGuards(SessionGuard, TenantGuard, PermissionGuard, StepUpGuard)
  @RequirePermission('team.manage')
  async changeRole(@Req() req: TenantRequest, @Param('memberId') memberId: string, @Body() body: unknown) {
    const dto = parse(RoleDto, body);
    await this.svc.changeRole(req.membership!.companyId, req.user!.id, memberIdOr404(memberId), dto.role);
    return { status: 'updated' };
  }

  @Delete('companies/:companyId/members/:memberId')
  @HttpCode(204)
  @UseGuards(SessionGuard, TenantGuard, PermissionGuard, StepUpGuard)
  @RequirePermission('team.manage')
  async remove(@Req() req: TenantRequest, @Param('memberId') memberId: string) {
    await this.svc.removeMember(req.membership!.companyId, req.user!.id, memberIdOr404(memberId));
  }
}

export type { AuthedRequest };
