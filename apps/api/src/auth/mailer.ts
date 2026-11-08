import { Injectable, Logger } from '@nestjs/common';

export interface Mail {
  to: string;
  template: 'verify-email' | 'password-reset' | 'company-invitation';
  /** Link/token the recipient needs. */
  token: string;
}

export const MAILER = Symbol('MAILER');

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/**
 * Development mailer: logs that a mail WOULD be sent. It does NOT deliver email.
 * The durable outbox + real provider arrive in the notifications slice (5.7).
 * The token itself is never logged.
 */
@Injectable()
export class LogMailer implements Mailer {
  private readonly log = new Logger('LogMailer');
  async send(mail: Mail): Promise<void> {
    this.log.warn(`[NOT DELIVERED - dev mailer] template=${mail.template}`);
  }
}

export interface DevMail {
  to: string;
  template: Mail['template'];
  link: string;
  at: string;
}

/** True only for local development with DEV_MAILBOX=1 set explicitly; never in production. */
export const devMailboxEnabled = () => process.env.NODE_ENV !== 'production' && process.env.DEV_MAILBOX === '1';

/**
 * Local development only: keeps the last 50 "sent" mails in memory so a developer can click the
 * verification / reset link. It still delivers nothing to any inbox, and is unavailable in production.
 */
@Injectable()
export class DevMailbox implements Mailer {
  readonly mails: DevMail[] = [];
  async send(mail: Mail): Promise<void> {
    const web = (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(',')[0]!;
    const path =
      mail.template === 'verify-email' ? `/en/verify-email?token=${encodeURIComponent(mail.token)}`
      : mail.template === 'password-reset' ? `/en/reset-password?token=${encodeURIComponent(mail.token)}`
      : `/en/invitation?token=${encodeURIComponent(mail.token)}`;
    this.mails.unshift({ to: mail.to, template: mail.template, link: `${web}${path}`, at: new Date().toISOString() });
    this.mails.length = Math.min(this.mails.length, 50);
  }
}
