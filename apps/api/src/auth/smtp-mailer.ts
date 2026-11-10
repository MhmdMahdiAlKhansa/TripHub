import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import nodemailer, { type Transporter } from 'nodemailer';
import type { Mail, Mailer } from './mailer';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
  webOrigin: string;
}

/** Reads SMTP settings from the environment; returns null when SMTP is not configured. */
export function smtpConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SmtpConfig | null {
  if (!env.SMTP_HOST) return null;
  // Accepts MAIL_FROM, or SMTP_FROM_EMAIL (+ optional SMTP_FROM_NAME) as many providers' docs name them.
  const from = env.MAIL_FROM || (env.SMTP_FROM_EMAIL ? (env.SMTP_FROM_NAME ? `${env.SMTP_FROM_NAME} <${env.SMTP_FROM_EMAIL}>` : env.SMTP_FROM_EMAIL) : '');
  if (!from) throw new Error('MAIL_FROM (or SMTP_FROM_EMAIL) is required when SMTP_HOST is set');
  if (env.SMTP_USER && !env.SMTP_USER.includes('@') && !env.SMTP_USER.includes(':')) {
    // Many providers use the full email address as the login; a missing "@" is almost always a typo.
    new Logger('SmtpMailer').warn('SMTP_USER does not look like an email address; check it for a typo');
  }
  const port = Number(env.SMTP_PORT ?? 587);
  return {
    host: env.SMTP_HOST,
    port,
    secure: env.SMTP_SECURE === 'true' || port === 465,
    user: env.SMTP_USER || undefined,
    // App passwords are often shown in groups separated by spaces; the spaces are not part of the password.
    pass: (env.SMTP_PASS || env.SMTP_PASSWORD || '').replace(/\s+/g, '') || undefined,
    from,
    webOrigin: (env.WEB_ORIGIN ?? 'http://localhost:3000').split(',')[0]!.trim(),
  };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface Copy { subject: string; intro: string; cta: string; ignore: string }
const COPY: Record<Exclude<Mail['template'], 'notification' | 'login-code'>, { en: Copy; ar: Copy; path: string }> = {
  'verify-email': {
    path: 'verify-email',
    en: { subject: 'Verify your email', intro: 'Confirm this email address to finish creating your TripHub account.', cta: 'Verify email', ignore: 'If you did not create an account, you can ignore this message.' },
    ar: { subject: 'تأكيد بريدك الإلكتروني', intro: 'أكّد عنوان البريد هذا لإكمال إنشاء حسابك في TripHub.', cta: 'تأكيد البريد', ignore: 'إذا لم تُنشئ حساباً فيمكنك تجاهل هذه الرسالة.' },
  },
  'password-reset': {
    path: 'reset-password',
    en: { subject: 'Reset your password', intro: 'Use this link to choose a new password. It works once and expires soon.', cta: 'Choose a new password', ignore: 'If you did not ask for this, ignore it: your password has not changed.' },
    ar: { subject: 'إعادة تعيين كلمة المرور', intro: 'استخدم هذا الرابط لاختيار كلمة مرور جديدة. يعمل مرة واحدة وينتهي قريباً.', cta: 'اختر كلمة مرور جديدة', ignore: 'إذا لم تطلب ذلك فتجاهل الرسالة: لم تتغير كلمة مرورك.' },
  },
  'company-invitation': {
    path: 'invitation',
    en: { subject: 'You are invited to join a business on TripHub', intro: 'You were invited to join a business team on TripHub. Sign in with this email address to accept.', cta: 'Accept invitation', ignore: 'If you were not expecting this, ignore it.' },
    ar: { subject: 'دعوة للانضمام إلى جهة على TripHub', intro: 'تمت دعوتك للانضمام إلى فريق جهة على TripHub. سجّل الدخول بهذا البريد للقبول.', cta: 'قبول الدعوة', ignore: 'إذا لم تكن تتوقع ذلك فتجاهل الرسالة.' },
  },
};

/** Builds the bilingual (English + Arabic) message. The one-time token appears only in the link. */
/** Short bilingual text for each in-app notification kind that is also emailed. */
const NOTES: Record<string, { en: string; ar: string }> = {
  'waitlist.offer': { en: 'A seat opened up on a date you were waiting for. Book it before the offer expires.', ar: 'تحرّر مقعد في تاريخ كنت تنتظره. احجزه قبل انتهاء العرض.' },
  'booking.request_approved': { en: 'Your booking request was approved. Open your bookings for the next step.', ar: 'تمت الموافقة على طلب حجزك. افتح حجوزاتك للخطوة التالية.' },
  'booking.request_declined': { en: 'Your booking request was declined.', ar: 'تم رفض طلب حجزك.' },
  'booking.completed': { en: 'Your trip is marked as completed. You can now leave a review.', ar: 'تم تسجيل رحلتك كمكتملة. يمكنك الآن كتابة تقييم.' },
  'booking.cancelled_by_business': { en: 'The business cancelled one of your bookings.', ar: 'ألغت الجهة أحد حجوزاتك.' },
  'payment.verified': { en: 'Your payment was verified.', ar: 'تم التحقق من دفعتك.' },
  'payment.verified_unallocated': { en: 'Your payment was verified, but the seats were no longer available. A refund is due to you.', ar: 'تم التحقق من دفعتك لكن المقاعد لم تعد متاحة. يحق لك استرداد المبلغ.' },
  'payment.rejected': { en: 'Your payment proof was not accepted.', ar: 'لم يتم قبول إثبات الدفع.' },
  'refund.approved': { en: 'Your refund was approved and is awaiting the transfer.', ar: 'تمت الموافقة على استردادك وهو بانتظار التحويل.' },
  'refund.paid': { en: 'Your refund has been sent.', ar: 'تم إرسال المبلغ المسترد.' },
  'refund.rejected': { en: 'Your refund request was not approved.', ar: 'لم تتم الموافقة على طلب الاسترداد.' },
};

export function renderMail(mail: Mail, webOrigin: string) {
  if (mail.template === 'notification') {
    const note = NOTES[mail.kind ?? ''] ?? { en: 'You have an update on TripHub.', ar: 'لديك تحديث على TripHub.' };
    const open = (loc: 'en' | 'ar') => `${webOrigin}/${loc}/profile`;
    const html = (t: string, label: string, loc: 'en' | 'ar', dir: 'ltr' | 'rtl') =>
      `<div dir="${dir}" style="font-family:system-ui,sans-serif;font-size:16px;line-height:1.5;color:#14304a;margin:0 0 24px"><p>${esc(t)}</p><p><a href="${esc(open(loc))}" style="display:inline-block;background:#0a6fd8;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:700">${esc(label)}</a></p></div>`;
    return {
      subject: 'TripHub update · تحديث من TripHub',
      text: `${note.en}\n${open('en')}\n\n----------\n\n${note.ar}\n${open('ar')}`,
      html: `<!doctype html><html><body style="background:#f8fbff;padding:24px">${html(note.en, 'Open TripHub', 'en', 'ltr')}<hr>${html(note.ar, 'افتح TripHub', 'ar', 'rtl')}</body></html>`,
    };
  }
  if (mail.template === 'login-code') {
    const en = `Your TripHub sign-in code is ${mail.token}. It works once and expires in 10 minutes. If you did not ask for it, ignore this message.`;
    const ar = `رمز دخولك إلى TripHub هو ${mail.token}. يعمل مرة واحدة وينتهي خلال 10 دقائق. إذا لم تطلبه فتجاهل هذه الرسالة.`;
    const block = (t: string, dir: 'ltr' | 'rtl') => `<div dir="${dir}" style="font-family:system-ui,sans-serif;font-size:16px;line-height:1.5;color:#14304a;margin:0 0 24px"><p>${esc(t)}</p><p style="font-size:32px;font-weight:700;letter-spacing:6px;direction:ltr">${esc(mail.token)}</p></div>`;
    return { subject: 'Your sign-in code · رمز الدخول', text: `${en}

----------

${ar}`, html: `<!doctype html><html><body style="background:#f8fbff;padding:24px">${block(en, 'ltr')}<hr>${block(ar, 'rtl')}</body></html>` };
  }
  const c = COPY[mail.template];
  const link = (loc: 'en' | 'ar') => `${webOrigin}/${loc}/${c.path}?token=${encodeURIComponent(mail.token)}`;
  const text = [
    `${c.en.intro}\n${link('en')}\n${c.en.ignore}`,
    `${c.ar.intro}\n${link('ar')}\n${c.ar.ignore}`,
  ].join('\n\n----------\n\n');
  const block = (copy: Copy, loc: 'en' | 'ar', dir: 'ltr' | 'rtl') =>
    `<div dir="${dir}" style="font-family:system-ui,sans-serif;font-size:16px;line-height:1.5;color:#14304a;margin:0 0 24px"><p>${esc(copy.intro)}</p><p><a href="${esc(link(loc))}" style="display:inline-block;background:#0a6fd8;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:700">${esc(copy.cta)}</a></p><p style="color:#455e77;font-size:14px">${esc(copy.ignore)}</p></div>`;
  return {
    subject: `${c.en.subject} · ${c.ar.subject}`,
    text,
    html: `<!doctype html><html><body style="background:#f8fbff;padding:24px">${block(c.en, 'en', 'ltr')}<hr>${block(c.ar, 'ar', 'rtl')}</body></html>`,
  };
}

/**
 * Sends through any SMTP server. "Accepted by the server" is all SMTP can tell us: we never claim an
 * email was DELIVERED. A failure is logged (without the token or full address) and never blocks the
 * request, because signup and reset responses must not reveal whether an address exists. There is no
 * durable retry queue yet.
 */
@Injectable()
export class SmtpMailer implements Mailer {
  private readonly log = new Logger('SmtpMailer');
  private readonly transport: Transporter;
  constructor(private readonly cfg: SmtpConfig) {
    this.transport = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      // Never send the login over an unencrypted connection to a remote server.
      requireTLS: !cfg.secure && !['localhost', '127.0.0.1'].includes(cfg.host),
      auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }

  /** Hands the message to the SMTP server; throws if the server did not accept it. */
  async deliver(mail: Mail): Promise<void> {
    const msg = renderMail(mail, this.cfg.webOrigin);
    const who = createHash('sha256').update(mail.to.toLowerCase()).digest('hex').slice(0, 10);
    await this.transport.sendMail({ from: this.cfg.from, to: mail.to, subject: msg.subject, text: msg.text, html: msg.html });
    this.log.log(`mail accepted by SMTP server template=${mail.template} to#${who}`);
  }

  async send(mail: Mail): Promise<void> {
    const who = createHash('sha256').update(mail.to.toLowerCase()).digest('hex').slice(0, 10);
    try {
      await this.deliver(mail);
    } catch (e) {
      this.log.error(`mail NOT sent template=${mail.template} to#${who}: ${(e as Error).message.replace(/token=[^&\s"]+/g, 'token=***')}`);
    }
  }
}
