import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { PrismaClient } from '@triphub/database';
import { SessionGuard } from '../auth/auth.guards';
import { PRISMA } from '../database/database.module';
import { PlatformGuard, RequirePlatformPermission } from './admin.guards';

const mask = (e: string) => e.replace(/^(.{2}).*(@.*)$/, '$1***$2');

/** Read-only view of outgoing email health. Failed messages cannot be re-sent: their link token is wiped on purpose. */
@ApiTags('admin')
@Controller({ path: 'admin/email', version: '1' })
@UseGuards(SessionGuard, PlatformGuard)
export class EmailAdminController {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  @Get()
  @RequirePlatformPermission('email.view')
  async overview() {
    const [grouped, failed] = await Promise.all([
      this.db.emailOutbox.groupBy({ by: ['status'], _count: { _all: true } }),
      this.db.emailOutbox.findMany({ where: { status: 'FAILED' }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, toEmail: true, template: true, attempts: true, lastError: true, createdAt: true } }),
    ]);
    return {
      counts: Object.fromEntries(grouped.map((g) => [g.status, g._count._all])),
      failed: failed.map((f) => ({ ...f, toEmail: mask(f.toEmail) })),
      note: 'SENT means accepted by the mail server, not delivered. Failed messages are not re-sent automatically; the user can request a new link.',
    };
  }
}
