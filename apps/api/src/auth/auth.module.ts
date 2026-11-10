import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { OriginGuard, SessionGuard } from './auth.guards';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { DevMailbox, devMailboxEnabled, LogMailer, MAILER } from './mailer';
import type { PrismaClient } from '@triphub/database';
import { PRISMA } from '../database/database.module';
import { OutboxMailer } from './outbox';
import { SmtpMailer, smtpConfigFromEnv } from './smtp-mailer';
import { DevMailboxController } from './dev-mailbox.controller';
import { GoogleAuthService } from './google.service';
import { PrivacyService } from './privacy.service';

@Module({
  controllers: [AuthController, DevMailboxController],
  providers: [
    AuthService,
    GoogleAuthService,
    PrivacyService,
    SessionGuard,
    DevMailbox,
    {
      provide: MAILER,
      // Priority: local dev mailbox (never production) > real SMTP when configured > log-only (delivers nothing).
      useFactory: (box: DevMailbox, db: PrismaClient) => {
        if (devMailboxEnabled()) return box;
        const smtp = smtpConfigFromEnv();
        // Real mail goes through the durable, retrying outbox.
        return smtp ? new OutboxMailer(db, new SmtpMailer(smtp)) : new LogMailer();
      },
      inject: [DevMailbox, PRISMA],
    },
    { provide: APP_GUARD, useClass: OriginGuard },
  ],
  exports: [AuthService, GoogleAuthService, SessionGuard, MAILER],
})
export class AuthModule {}
