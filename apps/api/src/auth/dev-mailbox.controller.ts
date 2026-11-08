import { Controller, Get, Inject, NotFoundException, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { DevMailbox, devMailboxEnabled } from './mailer';

/** Local development helper. 404 unless explicitly enabled, never in production, loopback callers only. */
@ApiExcludeController()
@Controller({ path: 'dev/mailbox', version: '1' })
export class DevMailboxController {
  constructor(@Inject(DevMailbox) private readonly box: DevMailbox) {}

  @Get()
  list(@Req() req: Request) {
    const ip = req.ip ?? '';
    const loopback = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
    if (!devMailboxEnabled() || !loopback) throw new NotFoundException();
    return { note: 'Development only. Nothing was delivered to any inbox.', mails: this.box.mails };
  }
}
