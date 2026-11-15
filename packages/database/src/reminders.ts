import type { PrismaClient } from './generated/client';
import { notify } from './notify';

/** Reminder window: trips starting between 18 and 30 hours from now get "tomorrow" reminders (job runs every few minutes). */
export const REMINDER_WINDOW_HOURS: readonly [number, number] = [18, 30];

/**
 * Sends one reminder per confirmed booking the day before the trip. Idempotent and safe to run concurrently:
 * the `reminderSentAt` flag is claimed atomically before the notification is created.
 */
export async function sendTripReminders(db: PrismaClient, now = new Date(), batch = 200): Promise<number> {
  const from = new Date(now.getTime() + REMINDER_WINDOW_HOURS[0] * 3_600_000);
  const to = new Date(now.getTime() + REMINDER_WINDOW_HOURS[1] * 3_600_000);
  let sent = 0;
  // Batches until nothing is due: every processed row is flagged, so the loop always ends.
  for (let round = 0; round < 100; round++) {
    const due = await db.booking.findMany({
      where: { status: 'CONFIRMED', reminderSentAt: null, slot: { startsAt: { gte: from, lte: to } } },
      select: { id: true, customerId: true, reference: true, pickupPoint: true, slot: { select: { startsAt: true } }, listing: { select: { meetingPoint: true } } },
      orderBy: { createdAt: 'asc' },
      take: batch,
    });
    if (due.length === 0) break;
    let progressed = 0;
    for (const b of due) {
      const claimed = await db.booking.updateMany({ where: { id: b.id, reminderSentAt: null }, data: { reminderSentAt: now } });
      if (claimed.count !== 1) continue;
      progressed++;
      await notify(db, b.customerId, 'booking.reminder', { bookingId: b.id, reference: b.reference, startsAt: b.slot.startsAt.toISOString(), pickupPoint: b.pickupPoint ?? b.listing.meetingPoint ?? null });
      sent++;
    }
    if (progressed === 0) break; // another worker claimed this batch
  }
  return sent;
}
