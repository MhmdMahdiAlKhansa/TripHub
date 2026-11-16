/**
 * Demo data for a local machine or a demo deployment (DEMO_SEED=1). The operator "Cedar Trails Lebanon" is a
 * fictional showcase business; the places and photographs are real; people are fictional Lebanese names; every
 * account uses the reserved `.test` mail domain so nothing can reach a real inbox. Idempotent: safe to re-run.
 *
 *   corepack pnpm --filter @triphub/api seed
 */
import 'reflect-metadata';
import path from 'node:path';
import { config } from 'dotenv';
import { createPrismaClient } from '@triphub/database';
import { encryptSecret, hashPassword } from './auth/crypto';
import { seedHosts } from './seed-hosts';
import { seedParticipants } from './seed-participants';
import { seedPlaces } from './seed-places';

config({ path: path.resolve(__dirname, '../../../.env') });

if (process.env.NODE_ENV === 'production' && process.env.DEMO_SEED !== '1') {
  console.error('Refusing to seed demo data when NODE_ENV=production (set DEMO_SEED=1 only on a demo deployment).');
  process.exit(1);
}

const DEMO_PASSWORD = 'Demo-Password-123!';
/** Fixed, publicly known authenticator secret for the LOCAL demo admin only (staff must use two-step sign-in). */
const DEMO_ADMIN_TOTP = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
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

  const owner = await user('owner@demo.triphub.test', 'Nadim Khoury');
  const customer = await user('customer@demo.triphub.test', 'Maya Haddad');
  await db.user.updateMany({ where: { email: { in: ['owner@demo.triphub.test', 'customer@demo.triphub.test'] }, displayName: { startsWith: 'DEMO' } }, data: {} });
  await db.user.update({ where: { email: 'owner@demo.triphub.test' }, data: { displayName: 'Nadim Khoury' } });
  await db.user.update({ where: { email: 'customer@demo.triphub.test' }, data: { displayName: 'Maya Haddad' } });

  // Platform admin: staff accounts require two-step sign-in, so this one has an authenticator secret set up.
  await db.user.upsert({
    where: { email: 'admin@demo.triphub.test' },
    create: { email: 'admin@demo.triphub.test', displayName: 'Lina Saab', passwordHash: hash, emailVerifiedAt: now, platformRole: 'ADMIN', mfaSecretEnc: encryptSecret(DEMO_ADMIN_TOTP), mfaEnabledAt: now },
    update: { displayName: 'Lina Saab', platformRole: 'ADMIN', mfaSecretEnc: encryptSecret(DEMO_ADMIN_TOTP), mfaEnabledAt: now, mfaLastStep: null },
  });

  const company =
    (await db.company.findUnique({ where: { slug: 'demo-cedar-guides' } })) ??
    (await db.company.create({
      data: {
        name: 'Cedar Trails Lebanon',
        slug: 'demo-cedar-guides',
        status: 'APPROVED',
        approvedAt: now,
        submittedAt: now,
        description: 'Small-group hikes and day trips across Lebanon: the Cedars, the Qadisha Valley, Byblos, Baalbek and the south. Pickups from Hamra and Jounieh. Deposits by Whish, OMT or cash.',
        contactEmail: 'hello@demo.triphub.test',
        phone: '+961 3 612 480',
        city: 'Beirut',
        categories: ['hiking', 'tours', 'historical'],
        languages: ['en', 'ar'],
      },
    }));
  // Older seeds named this operator "DEMO Cedar Guides"; bring it in line without changing its id or slug.
  await db.company.update({ where: { id: company.id }, data: { name: 'Cedar Trails Lebanon', city: 'Beirut', phone: '+961 3 612 480', categories: ['hiking', 'tours', 'historical'], description: 'Small-group hikes and day trips across Lebanon: the Cedars, the Qadisha Valley, Byblos, Baalbek and the south. Pickups from Hamra and Jounieh. Deposits by Whish, OMT or cash.' } });
  await db.membership.upsert({
    where: { companyId_userId: { companyId: company.id, userId: owner.id } },
    create: { companyId: company.id, userId: owner.id, role: 'OWNER' },
    update: {},
  });
  await db.subscription.upsert({
    where: { companyId: company.id },
    // The showcase operator is on a paid plan (no listing cap, no trial expiry), as a real customer would be.
    create: { companyId: company.id, planCode: 'PRO', status: 'ACTIVE', currentPeriodEnd: new Date(now.getTime() + 365 * day), commissionBps: 1000 },
    update: { planCode: 'PRO', status: 'ACTIVE', currentPeriodEnd: new Date(now.getTime() + 365 * day) },
  });

  // Retire listings from earlier seeds (placeholder titles) and any leftover sample operator.
  await db.listing.updateMany({ where: { status: { not: 'ARCHIVED' }, translations: { some: { locale: 'en', title: { startsWith: 'DEMO ' } } } }, data: { status: 'ARCHIVED' } });
  // Automated tests share the development database and leave published listings behind ("Approved Co" businesses,
  // gallery / load-test / e2e drafts). Hide them so the public site shows only the showcase operator.
  const junk = await db.listing.updateMany({
    where: {
      status: { in: ['PUBLISHED', 'PAUSED'] },
      OR: [
        { company: { name: 'Approved Co' } },
        { translations: { some: { locale: 'en', OR: [{ title: { startsWith: 'Gallery ' } }, { title: { startsWith: 'Load test ' } }, { title: { contains: 'E2E' } }] } } },
      ],
    },
    data: { status: 'ARCHIVED', featuredAt: null },
  });
  if (junk.count) console.log(`  hid ${junk.count} leftover test listings`);
  const leftover = await db.company.findUnique({ where: { slug: 'sample-lebanon-tours' } });
  if (leftover) {
    await db.listing.updateMany({ where: { companyId: leftover.id, status: { not: 'ARCHIVED' } }, data: { status: 'ARCHIVED', featuredAt: null } });
    await db.company.update({ where: { id: leftover.id }, data: { status: 'SUSPENDED', name: 'Retired sample operator' } });
  }

  await seedPlaces(db, company.id, owner.id, now);
  await seedParticipants(db, company.id, hash, now);
  await seedHosts(db, hash, now);

  console.log('Demo data ready: operator "Cedar Trails Lebanon" with real places, photos and sample participants.');
  console.log(`  business owner: owner@demo.triphub.test   password: ${DEMO_PASSWORD}`);
  console.log(`  customer:       customer@demo.triphub.test password: ${DEMO_PASSWORD}`);
  console.log(`  property host:  host@demo.triphub.test     password: ${DEMO_PASSWORD}`);
  console.log(`  platform admin: admin@demo.triphub.test    password: ${DEMO_PASSWORD}`);
  console.log(`  admin 2-step code: add this key to an authenticator app (Google Authenticator, etc.): ${DEMO_ADMIN_TOTP}`);
  console.log('  (demo only; never use these credentials outside a local machine)');
  void customer;
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
