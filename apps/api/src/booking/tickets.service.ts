import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@triphub/database';
import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { PRISMA } from '../database/database.module';

/** Check-in is allowed from this long before the start until the end (or this long after the start). */
const EARLY_MS = 6 * 3_600_000;
const DEFAULT_DURATION_MS = 12 * 3_600_000;

function key(): Buffer {
  const material = process.env.MFA_ENCRYPTION_KEY ?? process.env.SESSION_SECRET;
  if (!material || material.length < 32) throw new Error('MFA_ENCRYPTION_KEY (or SESSION_SECRET) must be >= 32 chars');
  return Buffer.from(hkdfSync('sha256', material, 'triphub', 'ticket-v1', 32));
}

const mac = (bookingId: string) => createHmac('sha256', key()).update(`ticket:${bookingId}`).digest('hex').slice(0, 20);

/** `<reference>.<mac>`: unguessable, unforgeable, and checkable without storing anything. */
export const ticketCode = (reference: string, bookingId: string) => `${reference}.${mac(bookingId)}`;

function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  // Neutralise spreadsheet formula injection from customer-controlled text.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

const icsEscape = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

@Injectable()
export class TicketsService {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  /** The customer's check-in code. Only a CONFIRMED booking has one: a HELD or requested booking is not a ticket. */
  async ticketFor(customerId: string, bookingId: string) {
    const b = await this.db.booking.findFirst({ where: { id: bookingId, customerId } });
    if (!b) throw new NotFoundException();
    if (b.status !== 'CONFIRMED') throw new ConflictException({ code: 'booking_not_confirmed', status: b.status });
    return { reference: b.reference, code: ticketCode(b.reference, b.id), checkedInAt: b.checkedInAt };
  }

  async calendarFor(customerId: string, bookingId: string): Promise<string> {
    const b = await this.db.booking.findFirst({ where: { id: bookingId, customerId }, include: { slot: true } });
    if (!b) throw new NotFoundException();
    if (b.status !== 'CONFIRMED') throw new ConflictException({ code: 'booking_not_confirmed', status: b.status });
    const snap = b.snapshot as { listing?: { title?: string }; company?: { name?: string } };
    const end = b.slot.endsAt ?? new Date(b.slot.startsAt.getTime() + 2 * 3_600_000);
    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//TripHub//Booking//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:${b.id}@triphub`,
      `DTSTAMP:${icsDate(new Date())}`,
      `DTSTART:${icsDate(b.slot.startsAt)}`,
      `DTEND:${icsDate(end)}`,
      `SUMMARY:${icsEscape(snap.listing?.title ?? 'TripHub booking')}`,
      `DESCRIPTION:${icsEscape(`Booking ${b.reference} with ${snap.company?.name ?? 'the organiser'}`)}`,
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ].join('\r\n');
  }

  /** Business scans/enters a code. Exactly one scan can win; repeats are reported, never double-counted. */
  async checkIn(companyId: string, actorId: string, code: string) {
    const [reference, given] = code.split('.');
    if (!reference || !given) throw new NotFoundException();
    const b = await this.db.booking.findFirst({ where: { reference, companyId }, include: { slot: true } });
    if (!b) throw new NotFoundException();
    const expected = Buffer.from(mac(b.id));
    const got = Buffer.from(given);
    if (expected.length !== got.length || !timingSafeEqual(expected, got)) throw new NotFoundException();

    if (b.status !== 'CONFIRMED') throw new ConflictException({ code: 'booking_not_confirmed', status: b.status });
    const now = Date.now();
    const opens = b.slot.startsAt.getTime() - EARLY_MS;
    const closes = (b.slot.endsAt ?? new Date(b.slot.startsAt.getTime() + DEFAULT_DURATION_MS)).getTime();
    if (now < opens || now > closes) throw new ConflictException({ code: 'outside_check_in_window' });

    const r = await this.db.booking.updateMany({ where: { id: b.id, status: 'CONFIRMED', checkedInAt: null }, data: { checkedInAt: new Date(), checkedInBy: actorId } });
    if (r.count !== 1) {
      const again = await this.db.booking.findUniqueOrThrow({ where: { id: b.id } });
      throw new ConflictException({ code: 'already_checked_in', checkedInAt: again.checkedInAt });
    }
    await this.db.auditEvent.create({
      data: { action: 'booking.checked_in', actorId, companyId, entityType: 'booking', entityId: b.id, meta: {} },
    });
    return { reference: b.reference, quantity: b.quantity, contactName: b.contactName };
  }

  /** CSV of the business's bookings for spreadsheets. Newest first, capped. */
  async exportCsv(companyId: string): Promise<string> {
    const rows = await this.db.booking.findMany({
      where: { companyId },
      include: { slot: true, customer: { select: { email: true } }, deposits: true },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });
    const head = ['reference', 'status', 'customer_email', 'contact_name', 'contact_phone', 'emergency_contact_name', 'emergency_contact_phone', 'pickup_point', 'seats', 'currency', 'total_minor', 'deposit_received_minor', 'starts_at', 'checked_in_at'];
    const lines = [head.map(csvCell).join(',')];
    for (const b of rows) {
      lines.push(
        [b.reference, b.status, b.customer.email, b.contactName, b.contactPhone, b.emergencyContactName, b.emergencyContactPhone, b.pickupPoint, b.quantity, b.currency, b.totalMinor.toString(), b.deposits.reduce((t, d) => t + d.amountMinor, 0n).toString(), b.slot.startsAt.toISOString(), b.checkedInAt?.toISOString()]
          .map(csvCell)
          .join(','),
      );
    }
    return lines.join('\r\n') + '\r\n';
  }
}
