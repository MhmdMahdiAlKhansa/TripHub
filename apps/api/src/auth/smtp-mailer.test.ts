import { simpleParser } from 'mailparser';
import { SMTPServer } from 'smtp-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderMail, SmtpMailer, smtpConfigFromEnv } from './smtp-mailer';

let server: SMTPServer;
let port = 0;
const received: Array<{ raw: string; to: string[] }> = [];

beforeAll(async () => {
  server = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS'],
    onData(stream, session, cb) {
      const chunks: Buffer[] = [];
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('end', () => {
        received.push({ raw: Buffer.concat(chunks).toString('utf8'), to: session.envelope.rcptTo.map((r) => r.address) });
        cb();
      });
    },
  });
  await new Promise<void>((res) => server.listen(0, '127.0.0.1', res));
  port = (server.server.address() as { port: number }).port;
});
afterAll(async () => new Promise<void>((res) => server.close(() => res())));

describe('SMTP mailer', () => {
  it('is only configured when SMTP_HOST is set, and requires a sender address', () => {
    expect(smtpConfigFromEnv({})).toBeNull();
    expect(() => smtpConfigFromEnv({ SMTP_HOST: 'smtp.example.test' })).toThrow(/MAIL_FROM/);
    expect(smtpConfigFromEnv({ SMTP_HOST: 'h', MAIL_FROM: 'TripHub <no-reply@example.test>', SMTP_PORT: '465' })).toMatchObject({ secure: true, port: 465 });
  });

  it('accepts the common alternative variable names and tidies app passwords', () => {
    const c = smtpConfigFromEnv({ SMTP_HOST: 'smtp.gmail.com', SMTP_USER: 'me@gmail.com', SMTP_PASSWORD: 'abcd efgh ijkl mnop', SMTP_FROM_EMAIL: 'me@gmail.com', SMTP_FROM_NAME: 'TripHub' });
    expect(c).toMatchObject({ pass: 'abcdefghijklmnop', from: 'TripHub <me@gmail.com>', port: 587, secure: false });
  });

  it('sends a bilingual message whose only copy of the token is the link', async () => {
    const mailer = new SmtpMailer({ host: '127.0.0.1', port, secure: false, from: 'TripHub <no-reply@example.test>', webOrigin: 'https://triphub.example' });
    await mailer.send({ to: 'maya@example.test', template: 'verify-email', token: 'tok_abc-123' });
    expect(received).toHaveLength(1);
    expect(received[0]!.to).toEqual(['maya@example.test']);
    const parsed = await simpleParser(received[0]!.raw);
    expect(parsed.subject).toContain('Verify your email');
    expect(parsed.subject).toContain('تأكيد بريدك الإلكتروني');
    expect(parsed.text).toContain('https://triphub.example/en/verify-email?token=tok_abc-123');
    expect(parsed.text).toContain('https://triphub.example/ar/verify-email?token=tok_abc-123');
    expect(String(parsed.html)).toContain('dir="rtl"');
  });

  it('escapes HTML and URL-encodes the token', () => {
    const m = renderMail({ to: 'a@b.test', template: 'password-reset', token: 'a b&c"<x>' }, 'https://t.example');
    expect(m.html).not.toContain('<x>');
    expect(m.text).toContain('token=a%20b%26c%22%3Cx%3E');
  });

  it('never throws when the server is unreachable (responses must not reveal whether an address exists)', async () => {
    const down = new SmtpMailer({ host: '127.0.0.1', port: 1, secure: false, from: 'x@example.test', webOrigin: 'https://t.example' });
    await expect(down.send({ to: 'a@b.test', template: 'password-reset', token: 'secret-token-value' })).resolves.toBeUndefined();
  });
});
