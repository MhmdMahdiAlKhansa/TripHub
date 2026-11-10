import 'reflect-metadata';
import path from 'node:path';
import { config } from 'dotenv';
import { createPrismaClient, type PrismaClient } from '@triphub/database';
import { simpleParser } from 'mailparser';
import { SMTPServer } from 'smtp-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BACKOFF_MINUTES, MAX_ATTEMPTS, OutboxMailer } from './outbox';
import { SmtpMailer } from './smtp-mailer';

config({ path: path.resolve(__dirname, '../../../../.env') });

let db: PrismaClient;
let server: SMTPServer;
let port = 0;
let failing = false;
const got: string[] = [];
let outbox: OutboxMailer;

beforeAll(async () => {
  db = createPrismaClient();
  server = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS'],
    onData(stream, _s, cb) {
      const chunks: Buffer[] = [];
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('end', () => {
        if (failing) return cb(Object.assign(new Error('452 mailbox busy, try later'), { responseCode: 452 }));
        got.push(Buffer.concat(chunks).toString('utf8'));
        cb();
      });
    },
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.server.address() as { port: number }).port;
  outbox = new OutboxMailer(db, new SmtpMailer({ host: '127.0.0.1', port, secure: false, from: 'TripHub <no-reply@example.test>', webOrigin: 'https://t.example' }), { autoStart: false, skipReservedDomains: false, eager: false });
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await db.$disconnect();
});

const addr = () => `outbox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
const dueNow = (id: string) => db.emailOutbox.update({ where: { id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
const drain = async (to: string) => {
  for (let i = 0; i < 5; i++) if ((await outbox.flush(50, to)) === 0) break;
};

describe('reserved test domains', () => {
  it('are never queued by the default outbox, so test accounts cannot cause real bounces', async () => {
    const real = new OutboxMailer(db, new SmtpMailer({ host: '127.0.0.1', port, secure: false, from: 'x@example.test', webOrigin: 'https://t.example' }), { autoStart: false });
    const to = addr();
    await real.send({ to, template: 'verify-email', token: 'T' });
    expect(await db.emailOutbox.count({ where: { toEmail: to } })).toBe(0);
  });
});

describe('durable email outbox', () => {
  it('queues first, encrypts the token at rest, sends, then wipes the payload', async () => {
    failing = false;
    const to = addr();
    await outbox.send({ to, template: 'verify-email', token: 'TOKEN-PLAINTEXT-123' });
    const row = await db.emailOutbox.findFirstOrThrow({ where: { toEmail: to } });
    expect(row.payloadEnc).toBeTruthy();
    expect(row.payloadEnc).not.toContain('TOKEN-PLAINTEXT-123');
    await drain(to);
    const done = await db.emailOutbox.findUniqueOrThrow({ where: { id: row.id } });
    expect(done).toMatchObject({ status: 'SENT', payloadEnc: null, lastError: null });
    expect(done.sentAt).not.toBeNull();
    const mine = got.find((m) => m.includes(to));
    expect(mine).toBeTruthy();
    expect((await simpleParser(mine!)).text).toContain('token=TOKEN-PLAINTEXT-123');
  });

  it('keeps a message that could not be sent, backs off, and delivers it once the server recovers', async () => {
    failing = true;
    const to = addr();
    await outbox.send({ to, template: 'password-reset', token: 'RESET-TOKEN-1' });
    await drain(to);
    const row = await db.emailOutbox.findFirstOrThrow({ where: { toEmail: to } });
    expect(row).toMatchObject({ status: 'QUEUED', attempts: 1 });
    expect(row.lastError).toContain('452');
    expect(row.lastError).not.toContain('RESET-TOKEN-1');
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + (BACKOFF_MINUTES[0]! - 0.5) * 60_000);

    failing = false;
    await dueNow(row.id);
    await drain(to);
    expect((await db.emailOutbox.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('SENT');
  });

  it('gives up after the last attempt and wipes the payload', async () => {
    failing = true;
    const to = addr();
    await outbox.send({ to, template: 'verify-email', token: 'GIVE-UP-TOKEN' });
    const id = (await db.emailOutbox.findFirstOrThrow({ where: { toEmail: to } })).id;
    for (let i = 0; i < MAX_ATTEMPTS + 1; i++) {
      await dueNow(id);
      await drain(to);
    }
    const row = await db.emailOutbox.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: 'FAILED', attempts: MAX_ATTEMPTS, payloadEnc: null });
    failing = false;
  });

  it('never sends the same message twice, even when two workers flush at once', async () => {
    failing = false;
    const to = addr();
    await outbox.send({ to, template: 'verify-email', token: 'ONCE' });
    await Promise.all([outbox.flush(50, to), outbox.flush(50, to), outbox.flush(50, to)]);
    await drain(to);
    expect(got.filter((m) => m.includes(to))).toHaveLength(1);
  });

  it('emails in-app notifications once, only to verified active users, with bilingual text', async () => {
    failing = false;
    const verified = await db.user.create({ data: { email: addr(), emailVerifiedAt: new Date() } });
    const unverified = await db.user.create({ data: { email: addr() } });
    await db.notification.create({ data: { userId: verified.id, kind: 'waitlist.offer', data: {} } });
    await db.notification.create({ data: { userId: unverified.id, kind: 'waitlist.offer', data: {} } });
    const ids = [verified.id, unverified.id];
    await outbox.queueNotificationEmails(500, ids);
    await outbox.queueNotificationEmails(500, ids); // second pass must not duplicate
    await drain(verified.email);
    const mails = got.filter((m) => m.includes(verified.email));
    expect(mails).toHaveLength(1);
    const parsed = await simpleParser(mails[0]!);
    expect(parsed.subject).toContain('TripHub update');
    expect(parsed.text).toContain('A seat opened up');
    expect(parsed.text).toContain('تحرّر مقعد');
    expect(got.some((m) => m.includes(unverified.email))).toBe(false);
  });
});
