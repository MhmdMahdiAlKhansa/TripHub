import { randomBytes } from 'node:crypto';
import { reserveSeats, type PrismaClient } from '@triphub/database';
import { requiredDepositMinor } from '@triphub/shared';

/**
 * Sample participants on the next Qadisha hike so the operator's desk looks like a real weekend: confirmed seats
 * with deposits recorded by Whish, OMT and cash, two seats still held for their deposit, and one person waiting.
 * Names are fictional; phone numbers use the Lebanese +961 format but are not real numbers.
 */
const PEOPLE = [
  { email: 'maya.haddad@demo.triphub.test', name: 'Maya Haddad', phone: '+961 70 184 522', pickup: 'Hamra, Beirut (Barbar)', emergency: ['Rami Haddad', '+961 71 390 614'], seats: 1, deposit: 'WHISH' },
  { email: 'karim.nassar@demo.triphub.test', name: 'Karim Nassar', phone: '+961 3 457 219', pickup: 'Dora roundabout', emergency: ['Dina Nassar', '+961 3 884 102'], seats: 2, deposit: 'CASH' },
  { email: 'rita.abou.jaoude@demo.triphub.test', name: 'Rita Abou Jaoude', phone: '+961 76 522 907', pickup: 'Jounieh highway (Fouad Chehab stadium)', emergency: ['Elie Abou Jaoude', '+961 3 215 778'], seats: 1, deposit: 'OMT' },
  { email: 'omar.sleiman@demo.triphub.test', name: 'Omar Sleiman', phone: '+961 81 630 455', pickup: 'Hamra, Beirut (Barbar)', emergency: ['Hala Sleiman', '+961 70 912 336'], seats: 1, deposit: 'WHISH' },
  { email: 'nour.khalil@demo.triphub.test', name: 'Nour Khalil', phone: '+961 71 048 263', pickup: 'Dora roundabout', emergency: ['Samir Khalil', '+961 1 742 118'], seats: 1, deposit: null },
  { email: 'jad.mansour@demo.triphub.test', name: 'Jad Mansour', phone: '+961 3 906 741', pickup: 'Hamra, Beirut (Barbar)', emergency: ['Lara Mansour', '+961 76 331 580'], seats: 1, deposit: null },
] as const;
const WAITING = { email: 'zeina.farah@demo.triphub.test', name: 'Zeina Farah', seats: 1 };

const REF_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const newReference = () => 'TH-' + Array.from(randomBytes(8), (b) => REF_ALPHABET[b % 32]).join('');

export async function seedParticipants(db: PrismaClient, companyId: string, passwordHash: string, now: Date) {
  const hike = await db.listing.findFirst({
    where: { companyId, status: 'PUBLISHED', translations: { some: { locale: 'en', title: { startsWith: 'Qadisha Valley' } } } },
    include: { rates: true, translations: { where: { locale: 'en' } }, slots: { where: { startsAt: { gt: now }, status: 'OPEN' }, orderBy: { startsAt: 'asc' }, take: 1 } },
  });
  const slot = hike?.slots[0];
  if (!hike || !slot) return;
  if ((await db.booking.count({ where: { slotId: slot.id } })) > 0) return; // already seeded
  const adult = hike.rates.find((r) => r.kind === 'ADULT');
  if (!adult) return;
  const title = hike.translations[0]?.title ?? 'Qadisha Valley hike';
  const owner = await db.membership.findFirst({ where: { companyId, role: 'OWNER', status: 'ACTIVE' } });
  if (!owner) return;

  for (const p of PEOPLE) {
    const user = await db.user.upsert({ where: { email: p.email }, create: { email: p.email, displayName: p.name, passwordHash, emailVerifiedAt: now }, update: { displayName: p.name } });
    const total = adult.amountMinor * BigInt(p.seats);
    const required = requiredDepositMinor(total, hike.depositPercent);
    const confirmed = p.deposit !== null;
    const createdAt = new Date(now.getTime() - (2 + PEOPLE.indexOf(p)) * 86_400_000);
    await db.$transaction(async (tx) => {
      if (!(await reserveSeats(tx, slot.id, p.seats))) return;
      const booking = await tx.booking.create({
        data: {
          reference: newReference(), companyId, listingId: hike.id, slotId: slot.id, customerId: user.id,
          status: confirmed ? 'CONFIRMED' : 'HELD', quantity: p.seats, currency: adult.currency, totalMinor: total,
          snapshot: {
            version: 1, createdAt: createdAt.toISOString(),
            listing: { id: hike.id, title, category: hike.category }, company: { id: companyId, name: 'Cedar Trails Lebanon' },
            slot: { id: slot.id, startsAt: slot.startsAt.toISOString(), endsAt: null }, currency: adult.currency,
            lines: [{ kind: 'ADULT', unitMinor: adult.amountMinor.toString(), qty: p.seats, seats: p.seats, subtotalMinor: total.toString() }],
            seats: p.seats, totalMinor: total.toString(), cancellationPolicy: { code: hike.cancellationPolicy },
          },
          contactName: p.name, contactPhone: p.phone, pickupPoint: p.pickup, emergencyContactName: p.emergency[0], emergencyContactPhone: p.emergency[1],
          idempotencyKey: `seed-${slot.id}-${p.email}`, requestHash: 'seed', createdAt,
        },
      });
      await tx.hold.create({
        data: { bookingId: booking.id, slotId: slot.id, quantity: p.seats, status: confirmed ? 'CONSUMED' : 'ACTIVE', expiresAt: new Date(Math.min(now.getTime() + 36 * 3_600_000, slot.startsAt.getTime())), resolvedAt: confirmed ? createdAt : null, createdAt },
      });
      if (p.deposit) {
        await tx.deposit.create({ data: { bookingId: booking.id, companyId, method: p.deposit, amountMinor: required, currency: adult.currency, reference: p.deposit === 'CASH' ? null : `${p.deposit.slice(0, 2)}-${createdAt.getTime().toString(36).toUpperCase()}`, recordedBy: owner.userId, recordedAt: new Date(createdAt.getTime() + 3_600_000) } });
      }
    });
  }
  // Fill the date and put one person on the waitlist.
  const slotNow = await db.slot.findUniqueOrThrow({ where: { id: slot.id } });
  if (slotNow.reserved < slotNow.capacity) await db.slot.update({ where: { id: slot.id }, data: { capacity: slotNow.reserved } });
  const waiting = await db.user.upsert({ where: { email: WAITING.email }, create: { email: WAITING.email, displayName: WAITING.name, passwordHash, emailVerifiedAt: now }, update: {} });
  await db.waitlistEntry.create({ data: { slotId: slot.id, customerId: waiting.id, seats: WAITING.seats } });
  console.log(`  participants: ${PEOPLE.length} bookings on "${title}" (${PEOPLE.filter((p) => p.deposit).length} with deposits, ${PEOPLE.filter((p) => !p.deposit).length} awaiting), 1 on the waitlist`);
}
