import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { PrismaClient } from '@triphub/database';
import { beirutInstant, beirutToday, quoteStay, shiftDay, stayRulesOf } from '@triphub/shared';
import { processImage } from './listings/images';
import { defaultStorage, newStorageKey } from './storage/storage';

/**
 * Demo property host "Mountain Homes Lebanon" (fictional) with three properties in real villages. The photos are
 * real, free-licensed pictures of those places or of a traditional Lebanese house (credits in docs/IMAGE_CREDITS.md);
 * they are not photos of a specific rentable property. Prices and bookings are invented for the demo.
 */
interface Prop {
  title: string; titleAr: string; description: string; descriptionAr: string; city: string; where: string;
  attributes: Record<string, unknown>; night: number; weekend: number | null; cleaning: number | null; depositPercent: number;
  photos: Array<{ file: string; alt: string }>; featured?: boolean;
}
const PROPS: Prop[] = [
  {
    title: 'Triple-arch stone house in Hasroun', titleAr: 'بيت حجري بثلاث قناطر في حصرون',
    description: 'A traditional Lebanese stone house with a triple-arched front, on the edge of the Qadisha Valley. Ten minutes from the Bsharri trailheads, twenty from the Cedars of God. Wood stove for winter, a terrace for summer evenings.',
    descriptionAr: 'بيت لبناني تقليدي من الحجر بواجهة ثلاثية القناطر على طرف وادي قاديشا. على بعد عشر دقائق من مسارات بشري وعشرين دقيقة من أرز الرب. موقدة للشتاء وشرفة لأمسيات الصيف.',
    city: 'Hasroun', where: 'Hasroun, below the main road, 200 m from the village square',
    attributes: { propertyType: 'guesthouse', maxGuests: 6, bedrooms: 3, beds: 4, bathrooms: 2, amenities: ['wifi', 'parking', 'heating', 'fireplace', 'kitchen', 'mountain_view', 'hot_water_24h', 'generator', 'hiking_trail_access'], checkInTime: '14:00', checkOutTime: '11:00', minNights: 2, houseRules: 'No parties. Quiet after 11 pm. Shoes off inside, please.' },
    night: 9000, weekend: 12000, cleaning: 2000, depositPercent: 30, featured: true,
    photos: [{ file: 'stay-old-house', alt: 'A traditional stone house with a triple-arched facade' }, { file: 'stay-hasroun-village', alt: 'A street in Hasroun village with old stone houses' }],
  },
  {
    title: 'Village house in Douma', titleAr: 'بيت ضيعة في دوما',
    description: 'A family house in the old village of Douma, with red-tiled roofs and stone lanes around it. A good base for walks in the Batroun hills and day trips to Batroun and Byblos.',
    descriptionAr: 'بيت عائلي في ضيعة دوما القديمة بين القرميد الأحمر والأزقة الحجرية. قاعدة جيدة للمشي في تلال البترون ولرحلات يومية إلى البترون وجبيل.',
    city: 'Douma', where: 'Douma, next to the old souk',
    attributes: { propertyType: 'chalet', maxGuests: 4, bedrooms: 2, beds: 3, bathrooms: 1, amenities: ['wifi', 'parking', 'heating', 'kitchen', 'garden', 'bbq', 'mountain_view', 'generator'], checkInTime: '15:00', checkOutTime: '11:00', minNights: 1 },
    night: 7000, weekend: 9000, cleaning: 1500, depositPercent: 50,
    photos: [{ file: 'stay-douma-centre', alt: 'The centre of Douma village' }],
  },
  {
    title: 'Guesthouse room in Jezzine', titleAr: 'غرفة في بيت ضيافة في جزين',
    description: 'A private room with breakfast in a family guesthouse in Jezzine, close to the waterfall and the pine forests. Ideal after a day hiking in the south.',
    descriptionAr: 'غرفة خاصة مع فطور في بيت ضيافة عائلي في جزين، قرب الشلال وغابات الصنوبر. مثالية بعد يوم مشي في الجنوب.',
    city: 'Jezzine', where: 'Jezzine, 5 minutes on foot from the waterfall',
    attributes: { propertyType: 'room', maxGuests: 2, bedrooms: 1, beds: 1, bathrooms: 1, amenities: ['wifi', 'breakfast', 'heating', 'mountain_view', 'hot_water_24h'], checkInTime: '14:00', checkOutTime: '10:30', minNights: 1 },
    night: 4500, weekend: null, cleaning: null, depositPercent: 100,
    photos: [{ file: 'stay-jezzine', alt: 'A view of Jezzine' }],
  },
];

const REF = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ref = () => 'TH-' + Array.from(randomBytes(8), (b) => REF[b % 32]).join('');

export async function seedHosts(db: PrismaClient, passwordHash: string, now: Date) {
  const storage = defaultStorage();
  const hostUser = await db.user.upsert({ where: { email: 'host@demo.triphub.test' }, create: { email: 'host@demo.triphub.test', displayName: 'Rana Fakhoury', passwordHash, emailVerifiedAt: now }, update: { displayName: 'Rana Fakhoury' } });
  const company =
    (await db.company.findUnique({ where: { slug: 'mountain-homes-lebanon' } })) ??
    (await db.company.create({
      data: {
        name: 'Mountain Homes Lebanon', slug: 'mountain-homes-lebanon', kind: 'HOST', status: 'APPROVED', approvedAt: now, submittedAt: now,
        description: 'Family-run guesthouses and village houses near the best hiking in North and South Lebanon.',
        contactEmail: 'stay@demo.triphub.test', phone: '+961 70 245 118', city: 'Hasroun', categories: ['stays'], languages: ['en', 'ar', 'fr'],
      },
    }));
  await db.membership.upsert({ where: { companyId_userId: { companyId: company.id, userId: hostUser.id } }, create: { companyId: company.id, userId: hostUser.id, role: 'OWNER' }, update: {} });
  await db.subscription.upsert({
    where: { companyId: company.id },
    create: { companyId: company.id, planCode: 'PRO', status: 'ACTIVE', currentPeriodEnd: new Date(now.getTime() + 365 * 86_400_000), commissionBps: 1000 },
    update: { planCode: 'PRO', status: 'ACTIVE', currentPeriodEnd: new Date(now.getTime() + 365 * 86_400_000) },
  });

  let created = 0;
  for (const p of PROPS) {
    const existing = await db.listingTranslation.findFirst({ where: { title: p.title, listing: { companyId: company.id } }, select: { listingId: true } });
    if (existing) {
      // Self-heal photo files on a fresh disk.
      const imgs = await db.listingImage.findMany({ where: { listingId: existing.listingId, deletedAt: null }, orderBy: { position: 'asc' } });
      for (const [i, img] of imgs.entries()) {
        const ph = p.photos[i];
        if (ph && !(await storage.get(img.storageKey).catch(() => null))) await storage.put(img.storageKey, await processImage(await readFile(path.resolve(__dirname, '../seed-photos', `${ph.file}.jpg`))));
      }
      continue;
    }
    const listing = await db.listing.create({
      data: {
        companyId: company.id, category: 'stays', bookingMode: 'NIGHTLY', status: 'PUBLISHED', publishedAt: now, city: p.city, meetingPoint: p.where,
        attributes: p.attributes as object, depositPercent: p.depositPercent, cancellationPolicy: 'MODERATE', featuredAt: p.featured ? now : null,
        translations: { create: [{ locale: 'en', title: p.title, description: p.description }, { locale: 'ar', title: p.titleAr, description: p.descriptionAr }] },
        rates: {
          create: [
            { kind: 'NIGHT', amountMinor: BigInt(p.night), currency: 'USD' },
            ...(p.weekend ? [{ kind: 'WEEKEND_NIGHT' as const, amountMinor: BigInt(p.weekend), currency: 'USD' }] : []),
            ...(p.cleaning ? [{ kind: 'CLEANING' as const, amountMinor: BigInt(p.cleaning), currency: 'USD' }] : []),
          ],
        },
      },
    });
    for (const [pos, ph] of p.photos.entries()) {
      const data = await processImage(await readFile(path.resolve(__dirname, '../seed-photos', `${ph.file}.jpg`)));
      const key = newStorageKey('img');
      await storage.put(key, data);
      await db.listingImage.create({ data: { listingId: listing.id, storageKey: key, contentType: 'image/webp', sizeBytes: data.length, sha256: createHash('sha256').update(data).digest('hex'), alt: ph.alt, position: pos, uploadedBy: hostUser.id } });
    }
    created++;
  }

  // A realistic calendar on the Hasroun house: one confirmed stay, one awaiting its deposit, and a host block.
  const house = await db.listing.findFirst({ where: { companyId: company.id, translations: { some: { title: PROPS[0]!.title } } }, include: { rates: true } });
  if (house && (await db.slot.count({ where: { listingId: house.id, kind: { in: ['STAY', 'BLOCK'] } } })) === 0) {
    const rules = stayRulesOf(house.attributes);
    const today = beirutToday(now);
    const pricing = { currency: 'USD' as const, nightMinor: 9000n, weekendNightMinor: 12000n, cleaningMinor: 2000n };
    const guests = [
      { email: 'lea.khoury@demo.triphub.test', name: 'Lea Khoury', phone: '+961 71 302 448', from: shiftDay(today, 6), nights: 2, people: 4, paid: true },
      { email: 'samir.daher@demo.triphub.test', name: 'Samir Daher', phone: '+961 3 884 960', from: shiftDay(today, 13), nights: 3, people: 2, paid: false },
    ];
    for (const g of guests) {
      const u = await db.user.upsert({ where: { email: g.email }, create: { email: g.email, displayName: g.name, passwordHash, emailVerifiedAt: now }, update: {} });
      const checkOut = shiftDay(g.from, g.nights);
      const q = quoteStay(pricing, { minNights: 1, maxGuests: 6 }, { checkIn: g.from, checkOut, guests: g.people }, today);
      const startsAt = beirutInstant(g.from, rules.checkInTime);
      const endsAt = beirutInstant(checkOut, rules.checkOutTime);
      await db.$transaction(async (tx) => {
        const slot = await tx.slot.create({ data: { listingId: house.id, kind: 'STAY', startsAt, endsAt, capacity: 1, reserved: 1 } });
        const b = await tx.booking.create({
          data: {
            reference: ref(), companyId: company.id, listingId: house.id, slotId: slot.id, customerId: u.id, status: g.paid ? 'CONFIRMED' : 'HELD', quantity: 1,
            currency: 'USD', totalMinor: q.totalMinor, contactName: g.name, contactPhone: g.phone, idempotencyKey: `seed-stay-${g.email}`, requestHash: 'seed',
            snapshot: {
              version: 1, kind: 'STAY', createdAt: now.toISOString(), listing: { id: house.id, title: PROPS[0]!.title, category: 'stays' }, company: { id: company.id, name: company.name },
              slot: { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() }, stay: { checkIn: g.from, checkOut, nights: g.nights, guests: g.people, checkInTime: rules.checkInTime, checkOutTime: rules.checkOutTime },
              currency: 'USD', lines: [{ kind: 'NIGHTS', qty: g.nights, subtotalMinor: q.nightsMinor.toString() }, { kind: 'CLEANING', qty: 1, subtotalMinor: q.cleaningMinor.toString() }],
              seats: 1, totalMinor: q.totalMinor.toString(), promo: null, commissionBps: 1000, taxesMinor: '0', feesMinor: '0', cancellationPolicy: { code: 'MODERATE', version: 1 },
            },
          },
        });
        await tx.hold.create({ data: { bookingId: b.id, slotId: slot.id, quantity: 1, status: g.paid ? 'CONSUMED' : 'ACTIVE', expiresAt: new Date(Math.min(now.getTime() + 40 * 3_600_000, startsAt.getTime())), resolvedAt: g.paid ? now : null } });
        if (g.paid) await tx.deposit.create({ data: { bookingId: b.id, companyId: company.id, method: 'WHISH', amountMinor: (q.totalMinor * 30n + 99n) / 100n, currency: 'USD', reference: `WH-${Date.now().toString(36).toUpperCase()}`, recordedBy: hostUser.id } });
      });
    }
    await db.slot.create({ data: { listingId: house.id, kind: 'BLOCK', startsAt: beirutInstant(shiftDay(today, 20), rules.checkInTime), endsAt: beirutInstant(shiftDay(today, 23), rules.checkOutTime), capacity: 0, reserved: 0, note: 'Family visiting' } });
  }
  console.log(`  property host: ${created} new properties under "Mountain Homes Lebanon" (host@demo.triphub.test)`);
}
