import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { OriginGuard, SessionGuard } from './auth.guards';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { DevMailbox, devMailboxEnabled, LogMailer, MAILER } from './mailer';
import { DevMailboxController } from './dev-mailbox.controller';

@Module({
  controllers: [AuthController, DevMailboxController],
  providers: [
    AuthService,
    SessionGuard,
    DevMailbox,
    { provide: MAILER, useFactory: (box: DevMailbox) => (devMailboxEnabled() ? box : new LogMailer()), inject: [DevMailbox] },
    { provide: APP_GUARD, useClass: OriginGuard },
  ],
  exports: [AuthService, SessionGuard, MAILER],
})
export class AuthModule {}
