/**
 * Local demo data. Everything is labelled DEMO, uses the reserved `.test` TLD, and the script refuses
 * to run in production. No payment, email or provider is involved: listings are free to book.
 *
 *   corepack pnpm --filter @triphub/api seed
 */
import 'reflect-metadata';
import path from 'node:path';
import { config } from 'dotenv';
import { createPrismaClient } from '@triphub/database';
import { hashPassword } from './auth/crypto';

config({ path: path.resolve(__dirname, '../../../.env') });

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed demo data when NODE_ENV=production.');
  process.exit(1);
}

const DEMO_PASSWORD = 'Demo-Password-123!';
const day = 86_400_000;

async function main() {
  const db = createPrismaClient();
  const hash = await hashPassword(DEMO_PASSWORD);
  const now = new Date();

  const user = (email: string, displayName: string) =>
    db.user.upsert({
      where: { email },
      create: { email, displayName, passwordHash: hash, emailVerifiedAt: now },
      update: {},
    });

  const owner = await user('owner@demo.triphub.test', 'DEMO Owner');
  const customer = await user('customer@demo.triphub.test', 'DEMO Traveller');

  const company =
    (await db.company.findUnique({ where: { slug: 'demo-cedar-guides' } })) ??
    (await db.company.create({
      data: {
        name: 'DEMO Cedar Guides',
        slug: 'demo-cedar-guides',
        status: 'APPROVED',
        approvedAt: now,
        submittedAt: now,
        description: 'DEMO data: guided hikes in the Qadisha Valley.',
        contactEmail: 'hello@demo.triphub.test',
        phone: '+961 3 000 000',
        city: 'Bsharri',
        categories: ['hiking'],
        languages: ['en', 'ar'],
      },
    }));
  await db.membership.upsert({
    where: { companyId_userId: { companyId: company.id, userId: owner.id } },
    create: { companyId: company.id, userId: owner.id, role: 'OWNER' },
    update: {},
  });
  await db.subscription.upsert({
    where: { companyId: company.id },
    create: {
      companyId: company.id,
      planCode: 'TRIAL',
      status: 'TRIALING',
      trialStartedAt: now,
      trialEndsAt: new Date(now.getTime() + 30 * day),
      trialConsentBy: owner.id,
      commissionBps: 1000,
    },
    update: {},
  });

  const items = [
    { en: 'DEMO Cedar Forest Walk', ar: 'تجريبي: جولة غابة الأرز', city: 'Bsharri', days: 5 },
    { en: 'DEMO Qadisha Valley Day Hike', ar: 'تجريبي: رحلة وادي قاديشا', city: 'Bsharri', days: 9 },
  ];
  for (const it of items) {
    const exists = await db.listingTranslation.findFirst({ where: { title: it.en, listing: { companyId: company.id } } });
    if (exists) continue;
    const listing = await db.listing.create({
      data: {
        companyId: company.id,
        category: 'hiking',
        bookingMode: 'FIXED_DATE',
        status: 'PUBLISHED',
        publishedAt: now,
        city: it.city,
        meetingPoint: 'Village square',
        attributes: { difficulty: 'moderate', distanceKm: 8, guideIncluded: true },
        translations: {
          create: [
            { locale: 'en', title: it.en, summary: 'DEMO listing', description: 'DEMO data: a calm guided walk with time for photos and tea.' },
            { locale: 'ar', title: it.ar, summary: 'بيانات تجريبية', description: 'بيانات تجريبية: جولة هادئة مع مرشد محلي.' },
          ],
        },
        rates: { create: [{ kind: 'ADULT', amountMinor: 0n, currency: 'USD' }] },
      },
    });
    await db.slot.create({ data: { listingId: listing.id, startsAt: new Date(now.getTime() + it.days * day), capacity: 12 } });
  }

  console.log('Demo data ready.');
  console.log(`  business owner: owner@demo.triphub.test   password: ${DEMO_PASSWORD}`);
  console.log(`  customer:       customer@demo.triphub.test password: ${DEMO_PASSWORD}`);
  console.log('  (demo only; never use these credentials outside a local machine)');
  void customer;
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
