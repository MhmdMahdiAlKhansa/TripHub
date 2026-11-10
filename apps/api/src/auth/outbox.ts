import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { PrismaClient } from '@triphub/database';
import { decryptSecret, encryptSecret } from './crypto';
import type { Mail, Mailer } from './mailer';

/** Minutes to wait before attempt 2, 3, 4, 5. After the fifth failed attempt the message is marked FAILED. */
export const BACKOFF_MINUTES = [1, 5, 15, 60];
export const MAX_ATTEMPTS = BACKOFF_MINUTES.length + 1;
const LEASE_MINUTES = 5;

/** Addresses on reserved test-only TLDs (RFC 2606/6761) can never be real; sending to them only creates bounces. */
export const isReservedDomain = (email: string) => /\.(test|invalid|example|localhost)$/i.test(email.split('@').pop() ?? '') || /@example\.(com|org|net)$/i.test(email);


/**
 * Durable, retrying email queue in front of a real transport. `send` only enqueues (so a slow or failing
 * mail server never slows or breaks a request); a timer in this process drains the queue. The message
 * payload, which can contain a one-time link token, is encrypted at rest and wiped once the server accepts
 * the message. "SENT" means accepted by the SMTP server, never delivered.
 */
@Injectable()
export class OutboxMailer implements Mailer, OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('EmailOutbox');
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly db: PrismaClient,
    private readonly transport: Mailer,
    private readonly opts: { autoStart: boolean; skipReservedDomains?: boolean; eager?: boolean } = { autoStart: true, skipReservedDomains: true, eager: true },
  ) {}

  onModuleInit() {
    if (!this.opts.autoStart) return;
    this.timer = setInterval(() => void this.tick().catch((e) => this.log.error(`outbox tick failed: ${(e as Error).message}`)), 20_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private skip(email: string) {
    return (this.opts.skipReservedDomains ?? true) && isReservedDomain(email);
  }

  async send(mail: Mail): Promise<void> {
    if (this.skip(mail.to)) {
      this.log.warn(`not queueing ${mail.template}: reserved test domain`);
      return;
    }
    await this.db.emailOutbox.create({ data: { toEmail: mail.to, template: mail.template, payloadEnc: encryptSecret(JSON.stringify({ token: mail.token, kind: mail.kind })) } });
    // Try straight away so users do not wait for the next tick; failures just stay queued.
    if (this.opts.eager ?? true) void this.flush(5).catch(() => undefined);
  }

  /** Queues an email copy of recent in-app notifications for users with a verified address. */
  async queueNotificationEmails(limit = 100, onlyUserIds?: string[]): Promise<number> {
    const since = new Date(Date.now() - 24 * 3_600_000);
    const rows = await this.db.notification.findMany({
      where: { emailedAt: null, createdAt: { gte: since }, ...(onlyUserIds ? { userId: { in: onlyUserIds } } : {}), user: { emailVerifiedAt: { not: null }, status: 'ACTIVE' } },
      include: { user: { select: { email: true } } },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    let n = 0;
    for (const r of rows) {
      // The flag is the gate: only the process that flips it enqueues the email.
      const claimed = await this.db.notification.updateMany({ where: { id: r.id, emailedAt: null }, data: { emailedAt: new Date() } });
      if (claimed.count !== 1 || this.skip(r.user.email)) continue;
      await this.db.emailOutbox.create({ data: { toEmail: r.user.email, template: 'notification', payloadEnc: encryptSecret(JSON.stringify({ token: '', kind: r.kind })) } });
      n++;
    }
    // Older ones are not worth emailing late; mark them so they are not rescanned.
    if (!onlyUserIds) await this.db.notification.updateMany({ where: { emailedAt: null, createdAt: { lt: since } }, data: { emailedAt: new Date(0) } });
    return n;
  }

  async tick(): Promise<{ queued: number; sent: number }> {
    const queued = await this.queueNotificationEmails();
    const sent = await this.flush(25);
    return { queued, sent };
  }

  /** Sends due messages. Each is leased first, so concurrent processes never send the same email twice. */
  async flush(limit = 25, onlyTo?: string): Promise<number> {
    const due = await this.db.$queryRaw<Array<{ id: string; toEmail: string; template: string; payloadEnc: string | null; attempts: number }>>`
      UPDATE "email_outbox" SET "attempts" = "attempts" + 1, "nextAttemptAt" = now() + make_interval(mins => ${LEASE_MINUTES}::int)
       WHERE "id" IN (
         SELECT "id" FROM "email_outbox"
          WHERE "status" = 'QUEUED' AND "nextAttemptAt" <= now() AND (${onlyTo ?? null}::text IS NULL OR "toEmail" = ${onlyTo ?? null}::text)
          ORDER BY "nextAttemptAt" LIMIT ${limit}::int FOR UPDATE SKIP LOCKED)
      RETURNING "id", "toEmail", "template", "payloadEnc", "attempts"`;
    let sent = 0;
    for (const m of due) {
      if (this.skip(m.toEmail)) {
        // Never hand test-only addresses to a real mail server (it would only bounce).
        await this.db.emailOutbox.update({ where: { id: m.id }, data: { status: 'FAILED', payloadEnc: null, lastError: 'reserved test domain: never sent' } });
        continue;
      }
      try {
        const p = m.payloadEnc ? (JSON.parse(decryptSecret(m.payloadEnc)) as { token: string; kind?: string }) : { token: '' };
        const mail: Mail = { to: m.toEmail, template: m.template as Mail['template'], token: p.token, kind: p.kind };
        if (this.transport.deliver) await this.transport.deliver(mail);
        else await this.transport.send(mail);
        await this.db.emailOutbox.update({ where: { id: m.id }, data: { status: 'SENT', sentAt: new Date(), payloadEnc: null, lastError: null } });
        sent++;
      } catch (e) {
        const msg = (e as Error).message.replace(/token=[^&\s"]+/g, 'token=***').slice(0, 300);
        const final = m.attempts >= MAX_ATTEMPTS;
        const wait = BACKOFF_MINUTES[Math.min(m.attempts - 1, BACKOFF_MINUTES.length - 1)]!;
        await this.db.emailOutbox.update({
          where: { id: m.id },
          data: final
            ? { status: 'FAILED', lastError: msg, payloadEnc: null }
            : { lastError: msg, nextAttemptAt: new Date(Date.now() + wait * 60_000) },
        });
        this.log.warn(`email ${m.template} attempt ${m.attempts}/${MAX_ATTEMPTS} failed${final ? ' (giving up)' : ''}`);
      }
    }
    return sent;
  }
}
