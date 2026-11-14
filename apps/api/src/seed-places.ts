import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { PrismaClient } from '@triphub/database';
import { processImage } from './listings/images';
import { defaultStorage, newStorageKey } from './storage/storage';

/**
 * Real places with real photographs (Wikimedia Commons, free licences; credits in docs/IMAGE_CREDITS.md and on the
 * site's photo-credits page). What is NOT real: the operator ("Sample Lebanon Tours"), the prices and the dates are
 * placeholders for local testing, and every listing says so. A real operator replaces them when one joins.
 */
interface Place {
  category: 'hiking' | 'tours' | 'historical';
  city: string;
  meeting: string;
  en: { title: string; summary: string; description: string };
  ar: { title: string; summary: string; description: string };
  attributes: Record<string, unknown>;
  priceUsd: number;
  photos: Array<{ file: string; alt: string }>;
  featured?: boolean;
}

const SAMPLE_EN = ' Sample listing: the operator, price and dates are placeholders for testing.';
const SAMPLE_AR = ' قائمة تجريبية: الجهة المنظمة والسعر والمواعيد أمثلة للاختبار.';

const PLACES: Place[] = [
  {
    category: 'hiking', city: 'Bsharri', meeting: 'Cedars of God visitor entrance', priceUsd: 20, featured: true,
    en: { title: 'Walk among the Cedars of God', summary: 'An easy walk through one of the last groves of Lebanon cedar.', description: 'Walk through the Cedars of God above Bsharri, one of the few remaining groves of ancient Lebanon cedar and part of the UNESCO-listed Qadisha Valley and Forest of the Cedars of God. A slow, easy walk with time for photos, and a small chapel on the slope.' + SAMPLE_EN },
    ar: { title: 'جولة بين أرز الرب', summary: 'مشي سهل بين واحدة من آخر غابات أرز لبنان.', description: 'امشِ بين أرز الرب فوق بشري، إحدى الغابات القليلة المتبقية من الأرز اللبناني العتيق، وهي جزء من وادي قاديشا وغابة أرز الرب المدرجين على قائمة اليونسكو. مشي هادئ وسهل مع وقت للتصوير، وكنيسة صغيرة على المنحدر.' + SAMPLE_AR },
    attributes: { difficulty: 'easy', durationMinutes: 120, distanceKm: 3, guideIncluded: true },
    photos: [{ file: 'cedars-forest', alt: 'Ancient Lebanon cedar trees at the Cedars of God' }, { file: 'cedars-chapel', alt: 'A small chapel on the slopes of Mount Lebanon at the Cedars of God' }],
  },
  {
    category: 'hiking', city: 'Bsharri', meeting: 'Bsharri village square', priceUsd: 35, featured: true,
    en: { title: 'Qadisha Valley and Mar Elisha monastery hike', summary: 'A day in the Holy Valley, with its cliffs and cave monasteries.', description: 'Hike into the Qadisha (Kadisha) Valley, the Holy Valley, a deep gorge below Bsharri with terraced slopes and monasteries built into the rock, including Mar Elisha. A moderate day hike with a local guide on valley paths.' + SAMPLE_EN },
    ar: { title: 'رحلة وادي قاديشا ودير مار أليشع', summary: 'يوم في الوادي المقدس بين الجروف والأديرة المحفورة في الصخر.', description: 'ادخل وادي قاديشا، الوادي المقدس، وهو مضيق عميق تحت بشري بمنحدرات مدرّجة وأديرة مبنية في الصخر، منها دير مار أليشع. رحلة نهارية متوسطة الصعوبة مع مرشد محلي على دروب الوادي.' + SAMPLE_AR },
    attributes: { difficulty: 'moderate', durationMinutes: 300, distanceKm: 9, guideIncluded: true },
    photos: [{ file: 'qadisha-aerial', alt: 'The Qadisha Valley seen from above, with a monastery on the slope' }, { file: 'qadisha-marelisha', alt: 'The monastery of Mar Elisha in the Qadisha Valley' }],
  },
  {
    category: 'tours', city: 'Jeita', meeting: 'Jeita Grotto entrance', priceUsd: 25,
    en: { title: 'Jeita Grotto visit', summary: 'Walk the galleries of the best-known cave in Lebanon.', description: 'Visit Jeita Grotto, a famous limestone cave system north of Beirut, with its large chambers of stalactites and stalagmites. A guided half-day visit.' + SAMPLE_EN },
    ar: { title: 'زيارة مغارة جعيتا', summary: 'تجوّل في أروقة أشهر مغارة في لبنان.', description: 'زر مغارة جعيتا، نظام كهوف كلسية شهير شمال بيروت بقاعات كبيرة من الصواعد والنوازل. زيارة مصحوبة بمرشد لنصف يوم.' + SAMPLE_AR },
    attributes: { durationMinutes: 180, tourLanguages: ['en', 'ar', 'fr'], maxGroupSize: 20, transportIncluded: false },
    photos: [{ file: 'jeita-1', alt: 'Stalactites inside Jeita Grotto' }, { file: 'jeita-2', alt: 'A lit chamber in Jeita Grotto' }],
  },
  {
    category: 'historical', city: 'Byblos', meeting: 'Byblos old port', priceUsd: 18, featured: true,
    en: { title: 'Byblos old port and ruins walk', summary: 'The harbour and ancient site of one of the oldest towns in the world.', description: 'Walk around the old harbour of Byblos (Jbeil), a UNESCO World Heritage site, and its ancient ruins and stone alleys. Byblos is often named among the oldest continuously inhabited towns in the world.' + SAMPLE_EN },
    ar: { title: 'جولة مرفأ جبيل القديم وآثارها', summary: 'المرفأ والموقع الأثري لواحدة من أقدم مدن العالم.', description: 'تجوّل حول مرفأ جبيل القديم، موقع التراث العالمي لليونسكو، وآثارها وأزقتها الحجرية. كثيراً ما تُذكر جبيل بين أقدم المدن المأهولة باستمرار في العالم.' + SAMPLE_AR },
    attributes: { era: 'Phoenician to Crusader' },
    photos: [{ file: 'byblos-harbour', alt: 'The old harbour of Byblos' }],
  },
  {
    category: 'historical', city: 'Baalbek', meeting: 'Baalbek archaeological site entrance', priceUsd: 30, featured: true,
    en: { title: 'Baalbek Roman temples tour', summary: 'The giant Roman temples of Heliopolis in the Bekaa.', description: 'Tour the Roman temple complex of Baalbek, a UNESCO World Heritage site in the Bekaa Valley, including the well-preserved Temple of Bacchus and the huge columns of the Temple of Jupiter.' + SAMPLE_EN },
    ar: { title: 'جولة معابد بعلبك الرومانية', summary: 'معابد هيليوبوليس الرومانية الضخمة في البقاع.', description: 'جُل في مجمّع معابد بعلبك الرومانية، موقع التراث العالمي لليونسكو في وادي البقاع، ومنها معبد باخوس المحفوظ جيداً وأعمدة معبد جوبيتر الضخمة.' + SAMPLE_AR },
    attributes: { era: 'Roman' },
    photos: [{ file: 'baalbek-bacchus', alt: 'The Temple of Bacchus at Baalbek' }],
  },
  {
    category: 'historical', city: 'Tyre', meeting: 'Al-Mina archaeological site gate', priceUsd: 20,
    en: { title: 'Tyre Al-Mina archaeological site', summary: 'Ruins of the ancient Phoenician port city of Tyre.', description: 'Explore the Al-Mina area of Tyre (Sour), part of the UNESCO-listed ancient city that was an important Phoenician port, with Roman and Byzantine remains on the Mediterranean coast.' + SAMPLE_EN },
    ar: { title: 'موقع المينا الأثري في صور', summary: 'آثار مدينة صور الفينيقية القديمة.', description: 'استكشف منطقة المينا في صور، جزء من المدينة القديمة المدرجة على قائمة اليونسكو والتي كانت مرفأً فينيقياً مهماً، وفيها بقايا رومانية وبيزنطية على ساحل المتوسط.' + SAMPLE_AR },
    attributes: { era: 'Phoenician, Roman, Byzantine' },
    photos: [{ file: 'tyre-almina', alt: 'Ancient ruins at the Al-Mina site in Tyre' }],
  },
  {
    category: 'historical', city: 'Beiteddine', meeting: 'Beiteddine Palace main gate', priceUsd: 22,
    en: { title: 'Beiteddine Palace visit', summary: 'A 19th-century palace in the Chouf mountains.', description: 'Visit Beiteddine Palace in the Chouf mountains, built in the early 19th century for Emir Bashir Shihab II, with its courtyards, fountains and mosaic floors.' + SAMPLE_EN },
    ar: { title: 'زيارة قصر بيت الدين', summary: 'قصر من القرن التاسع عشر في جبال الشوف.', description: 'زر قصر بيت الدين في جبال الشوف، الذي بُني في مطلع القرن التاسع عشر للأمير بشير الشهابي الثاني، بباحاته ونوافيره وأرضياته الفسيفسائية.' + SAMPLE_AR },
    attributes: { era: 'Early 19th century' },
    photos: [{ file: 'beiteddine-courtyard', alt: 'A courtyard at Beiteddine Palace' }],
  },
  {
    category: 'historical', city: 'Saida', meeting: 'Sea Castle causeway', priceUsd: 15,
    en: { title: 'Saida Sea Castle and old city', summary: 'A Crusader castle on a small island, and the old souks of Saida.', description: 'Walk to the Sea Castle of Saida (Sidon), a 13th-century fortress on a small island joined to the shore by a causeway, then wander the old city and its souks.' + SAMPLE_EN },
    ar: { title: 'قلعة صيدا البحرية والمدينة القديمة', summary: 'قلعة صليبية على جزيرة صغيرة وأسواق صيدا القديمة.', description: 'اعبر إلى قلعة صيدا البحرية، حصن من القرن الثالث عشر على جزيرة صغيرة يصلها بالشاطئ جسر، ثم تجوّل في المدينة القديمة وأسواقها.' + SAMPLE_AR },
    attributes: { era: 'Crusader' },
    photos: [{ file: 'sidon-seacastle', alt: 'The Sea Castle of Saida on its small island' }],
  },
  {
    category: 'historical', city: 'Anjar', meeting: 'Anjar site entrance', priceUsd: 18,
    en: { title: 'Anjar Umayyad city', summary: 'The ruins of an early 8th-century Umayyad city in the Bekaa.', description: 'Visit Anjar, the ruins of a planned Umayyad city of the early 8th century in the Bekaa Valley, a UNESCO World Heritage site, with its colonnaded streets and palace remains.' + SAMPLE_EN },
    ar: { title: 'مدينة عنجر الأموية', summary: 'آثار مدينة أموية من مطلع القرن الثامن في البقاع.', description: 'زر عنجر، آثار مدينة أموية مخططة من مطلع القرن الثامن في وادي البقاع، موقع التراث العالمي لليونسكو، بشوارعها ذات الأعمدة وبقايا القصر.' + SAMPLE_AR },
    attributes: { era: 'Umayyad' },
    photos: [{ file: 'anjar-1', alt: 'Ruins of the Umayyad city of Anjar' }],
  },
  {
    category: 'tours', city: 'Beirut', meeting: 'Raouche seafront', priceUsd: 12,
    en: { title: 'Raouche Pigeon Rocks coastal walk', summary: 'A sea-front walk to the famous rock formation of Beirut.', description: 'Walk the Beirut seafront to Raouche and the Pigeon Rocks, the two large sea stacks that stand just off the coast and are one of the best-known sights of the city.' + SAMPLE_EN },
    ar: { title: 'جولة صخرة الروشة الساحلية', summary: 'مشي على الواجهة البحرية إلى معلم بيروت الشهير.', description: 'امشِ على الواجهة البحرية في بيروت إلى الروشة وصخرتها، الصخرتان الكبيرتان القائمتان قرب الشاطئ وإحدى أشهر معالم المدينة.' + SAMPLE_AR },
    attributes: { durationMinutes: 90, tourLanguages: ['en', 'ar'], maxGroupSize: 15, transportIncluded: false },
    photos: [{ file: 'beirut-pigeon-rocks', alt: 'The Pigeon Rocks at Raouche, Beirut' }],
  },
  {
    category: 'tours', city: 'Batroun', meeting: 'Batroun old harbour', priceUsd: 15,
    en: { title: 'Batroun old town and harbour', summary: 'A coastal town with a small harbour and an ancient sea wall.', description: 'Stroll through the old town of Batroun on the north coast, its small harbour, churches and the ancient Phoenician sea wall.' + SAMPLE_EN },
    ar: { title: 'البترون: المدينة القديمة والمرفأ', summary: 'بلدة ساحلية بمرفأ صغير وسور بحري قديم.', description: 'تجوّل في بلدة البترون القديمة على الساحل الشمالي ومرفئها الصغير وكنائسها والسور الفينيقي القديم على البحر.' + SAMPLE_AR },
    attributes: { durationMinutes: 120, tourLanguages: ['en', 'ar'], maxGroupSize: 15, transportIncluded: false },
    photos: [{ file: 'batroun-harbour', alt: 'The old harbour of Batroun' }],
  },
];

export async function seedPlaces(db: PrismaClient, ownerId: string, now: Date) {
  const day = 86_400_000;
  const storage = defaultStorage();
  const company =
    (await db.company.findUnique({ where: { slug: 'sample-lebanon-tours' } })) ??
    (await db.company.create({
      data: {
        name: 'Sample Lebanon Tours', slug: 'sample-lebanon-tours', status: 'APPROVED', approvedAt: now, submittedAt: now,
        description: 'Sample operator for local testing. The places and photographs are real; the operator, prices and dates are placeholders.',
        contactEmail: 'sample@demo.triphub.test', phone: '+961 3 000 001', city: 'Beirut', categories: ['hiking', 'tours', 'historical'], languages: ['en', 'ar'],
      },
    }));
  await db.membership.upsert({ where: { companyId_userId: { companyId: company.id, userId: ownerId } }, create: { companyId: company.id, userId: ownerId, role: 'OWNER' }, update: {} });
  await db.subscription.upsert({
    where: { companyId: company.id },
    create: { companyId: company.id, planCode: 'TRIAL', status: 'TRIALING', trialStartedAt: now, trialEndsAt: new Date(now.getTime() + 30 * day), trialConsentBy: ownerId, commissionBps: 1000 },
    update: {},
  });

  let created = 0;
  for (const [n, p] of PLACES.entries()) {
    if (await db.listingTranslation.findFirst({ where: { title: p.en.title, listing: { companyId: company.id } } })) continue;
    const listing = await db.listing.create({
      data: {
        companyId: company.id, category: p.category, bookingMode: 'FIXED_DATE', status: 'PUBLISHED', publishedAt: now, city: p.city, meetingPoint: p.meeting,
        attributes: p.attributes as object, featuredAt: p.featured ? now : null,
        translations: { create: [{ locale: 'en', ...p.en }, { locale: 'ar', ...p.ar }] },
        rates: { create: [{ kind: 'ADULT', amountMinor: BigInt(p.priceUsd * 100), currency: 'USD' }, { kind: 'CHILD', amountMinor: BigInt(Math.round(p.priceUsd * 50)), currency: 'USD' }] },
      },
    });
    for (const d of [4 + n, 11 + n, 18 + n, 25 + n]) await db.slot.create({ data: { listingId: listing.id, startsAt: new Date(now.getTime() + d * day + 8 * 3_600_000), capacity: 16 } });
    for (const [pos, ph] of p.photos.entries()) {
      const raw = await readFile(path.resolve(__dirname, '../seed-photos', `${ph.file}.jpg`));
      const data = await processImage(raw);
      const key = newStorageKey('img');
      await storage.put(key, data);
      await db.listingImage.create({ data: { listingId: listing.id, storageKey: key, contentType: 'image/webp', sizeBytes: data.length, sha256: createHash('sha256').update(data).digest('hex'), alt: ph.alt, position: pos, uploadedBy: ownerId } });
    }
    created++;
  }
  console.log(`  real places: ${created} new listings (${PLACES.length} total) under "Sample Lebanon Tours"`);
}
