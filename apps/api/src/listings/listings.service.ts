import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, type PrismaClient } from '@triphub/database';
import {
  canTransitionListing,
  missingForPublish,
  regionCities,
  searchTerms,
  type RegionSlug,
  validateAttributes,
  type Category,
  type ListingStatus,
} from '@triphub/shared';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { FEATURES, type Features } from '../config/features';
import { PRISMA } from '../database/database.module';
import type { CreateListingInput, UpdateListingInput } from './listing.dto';


const listingInclude = {
  translations: true,
  rates: true,
  images: { where: { deletedAt: null }, orderBy: { position: 'asc' } },
} satisfies Prisma.ListingInclude;
type ListingFull = Prisma.ListingGetPayload<{ include: typeof listingInclude }>;

const dec = (n: number | null | undefined) => (n === undefined ? undefined : n === null ? null : new Prisma.Decimal(n));

@Injectable()
export class ListingsService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(FEATURES) private readonly features: Features,
    @Inject(SubscriptionsService) private readonly subs: SubscriptionsService,
  ) {}

  private audit(action: string, actorId: string, companyId: string, listingId: string, meta: object = {}) {
    return this.db.auditEvent.create({
      data: { action, actorId, companyId, entityType: 'listing', entityId: listingId, meta },
    });
  }

  private checkAttributes(category: string, attributes: unknown) {
    const r = validateAttributes(category as Category, attributes ?? {});
    if (!r.success) {
      throw new BadRequestException({
        code: 'invalid_attributes',
        issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return r.data;
  }

  async create(companyId: string, actorId: string, input: CreateListingInput): Promise<ListingFull> {
    const attributes = this.checkAttributes(input.category, input.attributes);
    const listing = await this.db.listing.create({
      data: {
        companyId,
        category: input.category,
        bookingMode: input.bookingMode,
        cancellationPolicy: input.cancellationPolicy,
        city: input.city,
        address: input.address,
        latitude: dec(input.latitude),
        longitude: dec(input.longitude),
        meetingPoint: input.meetingPoint,
        meetingLatitude: dec(input.meetingLatitude),
        meetingLongitude: dec(input.meetingLongitude),
        attributes: attributes as Prisma.InputJsonValue,
        translations: {
          create: Object.entries(input.translations).map(([locale, t]) => ({
            locale,
            title: t!.title,
            summary: t!.summary ?? null,
            description: t!.description ?? null,
          })),
        },
      },
      include: listingInclude,
    });
    await this.audit('listing.created', actorId, companyId, listing.id, { category: input.category });
    return listing;
  }

  list(companyId: string, status?: ListingStatus): Promise<ListingFull[]> {
    return this.db.listing.findMany({
      where: { companyId, ...(status ? { status } : {}) },
      include: listingInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(companyId: string, listingId: string): Promise<ListingFull> {
    // Always scoped by company: another tenant's listing id is simply not found.
    const l = await this.db.listing.findFirst({ where: { id: listingId, companyId }, include: listingInclude });
    if (!l) throw new NotFoundException();
    return l;
  }

  async update(companyId: string, listingId: string, actorId: string, input: UpdateListingInput): Promise<ListingFull> {
    const current = await this.get(companyId, listingId);
    if (current.status === 'ARCHIVED') throw new ConflictException({ code: 'listing_archived' });
    if (input.bookingMode && input.bookingMode !== current.bookingMode && current.status === 'PUBLISHED') {
      throw new ConflictException({ code: 'cannot_change_booking_mode_while_published' });
    }
    const attributes =
      input.attributes !== undefined ? (this.checkAttributes(current.category, input.attributes) as Prisma.InputJsonValue) : undefined;

    await this.db.$transaction(async (tx) => {
      const res = await tx.listing.updateMany({
        where: { id: listingId, companyId, status: current.status },
        data: {
          bookingMode: input.bookingMode,
          cancellationPolicy: input.cancellationPolicy,
          city: input.city,
          address: input.address,
          latitude: dec(input.latitude),
          longitude: dec(input.longitude),
          meetingPoint: input.meetingPoint,
          meetingLatitude: dec(input.meetingLatitude),
          meetingLongitude: dec(input.meetingLongitude),
          attributes,
        },
      });
      if (res.count !== 1) throw new ConflictException({ code: 'listing_changed_concurrently' });
      for (const [locale, t] of Object.entries(input.translations ?? {})) {
        await tx.listingTranslation.upsert({
          where: { listingId_locale: { listingId, locale } },
          create: { listingId, locale, title: t!.title, summary: t!.summary ?? null, description: t!.description ?? null },
          update: {
            title: t!.title,
            ...(t!.summary !== undefined ? { summary: t!.summary } : {}),
            ...(t!.description !== undefined ? { description: t!.description } : {}),
          },
        });
      }
    });
    await this.audit('listing.updated', actorId, companyId, listingId, { fields: Object.keys(input) });
    return this.get(companyId, listingId);
  }

  async transition(companyId: string, listingId: string, actorId: string, to: ListingStatus): Promise<ListingFull> {
    const l = await this.get(companyId, listingId);
    if (!canTransitionListing(l.status as ListingStatus, to)) {
      throw new ConflictException({ code: 'invalid_transition', from: l.status, to });
    }

    if (to === 'PUBLISHED') {
      const company = await this.db.company.findUniqueOrThrow({ where: { id: companyId }, select: { status: true } });
      if (company.status !== 'APPROVED') {
        throw new ConflictException({ code: 'company_not_verified', status: company.status });
      }
      await this.subs.assertCanPublish(companyId);
      if (l.bookingMode === 'REQUEST_TO_BOOK' && !this.features.requestToBook) {
        throw new ConflictException({ code: 'booking_mode_not_supported_yet' });
      }
      if (l.bookingMode !== 'DISCOVERY_ONLY') {
        // Never advertise a price we cannot take, or a bookable listing with no price card.
        const rates = await this.db.listingRate.findMany({ where: { listingId } });
        if (rates.length === 0) throw new UnprocessableEntityException({ code: 'incomplete_listing', missing: ['rates'] });
        if (!this.features.payments && rates.some((r) => r.amountMinor > 0n)) {
          throw new ConflictException({ code: 'payments_not_available_yet' });
        }
      }
      const missing = missingForPublish({
        bookingMode: l.bookingMode,
        city: l.city,
        meetingPoint: l.meetingPoint,
        translations: l.translations,
      });
      if (missing.length) throw new UnprocessableEntityException({ code: 'incomplete_listing', missing });
    }

    const res = await this.db.listing.updateMany({
      where: { id: listingId, companyId, status: l.status },
      data: { status: to, ...(to === 'PUBLISHED' && !l.publishedAt ? { publishedAt: new Date() } : {}) },
    });
    if (res.count !== 1) throw new ConflictException({ code: 'invalid_transition', from: l.status, to });
    await this.audit(`listing.${to.toLowerCase()}`, actorId, companyId, listingId, { from: l.status });
    return this.get(companyId, listingId);
  }

  // ------------------------------------------------------------------ public reads

  private publicWhere(): Prisma.ListingWhereInput {
    // The company must still be verified: suspending a company hides its listings immediately.
    // A listing with no text at all can never be shown to the public.
    return { status: 'PUBLISHED', company: { status: 'APPROVED' }, translations: { some: {} } };
  }

  /** Ids of listings whose (Arabic-normalised) text contains every search term. */
  private async searchIds(q: string): Promise<string[]> {
    const terms = searchTerms(q);
    if (terms.length === 0) return [];
    // Terms are bound parameters; LIKE metacharacters are escaped so they match literally.
    const BACKSLASH = String.fromCharCode(92);
    const patterns = terms.map((t) => `%${[...t].map((c) => (c === BACKSLASH || c === '%' || c === '_' ? BACKSLASH + c : c)).join('')}%`);
    const rows = await this.db.$queryRaw<Array<{ listingId: string }>>`
      SELECT DISTINCT "listingId" FROM "listing_translation"
       WHERE "searchText" ILIKE ALL (${patterns}::text[])
       LIMIT 1000`;
    return rows.map((r) => r.listingId);
  }

  /** Listings with an open date on that Beirut day and at least `guests` seats left. */
  private async availableIds(date: string, guests: number): Promise<string[]> {
    const rows = await this.db.$queryRaw<Array<{ listingId: string }>>`
      SELECT DISTINCT "listingId" FROM "slot"
       WHERE "status" = 'OPEN' AND "startsAt" > now()
         AND ("startsAt" AT TIME ZONE 'Asia/Beirut')::date = ${date}::date
         AND "capacity" - "reserved" >= ${guests}
       LIMIT 1000`;
    return rows.map((r) => r.listingId);
  }

  async listPublic(opts: {
    category?: string; city?: string; q?: string; limit: number; cursor?: string;
    region?: RegionSlug; date?: string; guests?: number; maxPriceMinor?: number; mode?: 'bookable' | 'discovery'; featured?: 'true';
  }) {
    const searchIds = opts.q ? await this.searchIds(opts.q) : null;
    const availIds = opts.date ? await this.availableIds(opts.date, opts.guests ?? 1) : null;
    // Several id filters narrow each other; an empty intersection means no results, never "everything".
    const idFilter = [searchIds, availIds].filter((x): x is string[] => x !== null);
    const ids = idFilter.length === 0 ? null : idFilter.reduce((a, b) => a.filter((x) => b.includes(x)));
    const where: Prisma.ListingWhereInput = {
      ...this.publicWhere(),
      ...(opts.category ? { category: opts.category } : {}),
      ...(opts.city ? { city: { equals: opts.city, mode: 'insensitive' } } : {}),
      ...(ids ? { id: { in: ids } } : {}),
      ...(opts.featured ? { featuredAt: { not: null } } : {}),
      ...(opts.region ? { OR: regionCities(opts.region).map((c) => ({ city: { equals: c, mode: 'insensitive' as const } })) } : {}),
      ...(opts.maxPriceMinor !== undefined ? { rates: { some: { currency: 'USD', amountMinor: { lte: BigInt(opts.maxPriceMinor) } } } } : {}),
      ...(opts.mode === 'bookable' ? { bookingMode: { not: 'DISCOVERY_ONLY' as const } } : opts.mode === 'discovery' ? { bookingMode: 'DISCOVERY_ONLY' as const } : {}),
    };
    const rows = await this.db.listing.findMany({
      where,
      include: { ...listingInclude, company: { select: { slug: true, name: true } } },
      orderBy: opts.featured ? [{ featuredAt: 'desc' }, { id: 'desc' }] : [{ publishedAt: 'desc' }, { id: 'desc' }],
      take: opts.limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, opts.limit);
    return { listings: page, nextCursor: rows.length > opts.limit ? page[page.length - 1]!.id : null };
  }

  /** Other public experiences in the same city (or, failing that, the same category), never the listing itself. */
  async nearby(id: string, limit = 3) {
    const base = await this.getPublic(id);
    const include = { ...listingInclude, company: { select: { slug: true, name: true } } };
    const sameCity = base.city
      ? await this.db.listing.findMany({
          where: { ...this.publicWhere(), id: { not: id }, city: { equals: base.city, mode: 'insensitive' } },
          include, orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }], take: limit,
        })
      : [];
    if (sameCity.length >= limit) return sameCity;
    const rest = await this.db.listing.findMany({
      where: { ...this.publicWhere(), id: { notIn: [id, ...sameCity.map((l) => l.id)] }, category: base.category },
      include, orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }], take: limit - sameCity.length,
    });
    return [...sameCity, ...rest];
  }

  async getPublic(id: string) {
    const l = await this.db.listing.findFirst({
      where: { id, ...this.publicWhere() },
      include: { ...listingInclude, company: { select: { slug: true, name: true } } },
    });
    if (!l) throw new NotFoundException();
    return l;
  }
}

type WithCompany = ListingFull & { company?: { slug: string; name: string } };

/** Picks the requested locale, falling back to any other available translation. */
export function pickTranslation(l: ListingFull, locale: string) {
  return l.translations.find((t) => t.locale === locale) ?? l.translations[0] ?? null;
}

const cheapest = (rates: Array<{ amountMinor: bigint; currency: string }>) => {
  const usd = rates.filter((r) => r.currency === 'USD');
  const pool = usd.length ? usd : rates;
  if (pool.length === 0) return null;
  const best = pool.reduce((a, b) => (b.amountMinor < a.amountMinor ? b : a));
  return { amountMinor: best.amountMinor.toString(), currency: best.currency };
};
const imageUrl = (i: { id: string; alt: string | null }) => ({ id: i.id, url: `/api/v1/public/listing-images/${i.id}`, alt: i.alt });
const num = (d: Prisma.Decimal | null) => (d === null ? null : Number(d));

export function privateListing(l: ListingFull) {
  return {
    id: l.id,
    category: l.category,
    bookingMode: l.bookingMode,
    cancellationPolicy: l.cancellationPolicy,
    images: l.images.map(imageUrl),
    status: l.status,
    city: l.city,
    address: l.address,
    latitude: num(l.latitude),
    longitude: num(l.longitude),
    meetingPoint: l.meetingPoint,
    meetingLatitude: num(l.meetingLatitude),
    meetingLongitude: num(l.meetingLongitude),
    attributes: l.attributes,
    publishedAt: l.publishedAt,
    translations: Object.fromEntries(
      l.translations.map((t) => [t.locale, { title: t.title, summary: t.summary, description: t.description }]),
    ),
  };
}

/** Public shape: no status internals, no drafts; the company badge means platform-verified. */
export function publicListing(l: WithCompany, locale: string) {
  const t = pickTranslation(l, locale);
  return {
    id: l.id,
    category: l.category,
    bookingMode: l.bookingMode,
    // Discovery-only listings never imply bookability.
    bookable: l.bookingMode !== 'DISCOVERY_ONLY',
    cancellationPolicy: l.cancellationPolicy,
    images: l.images.map(imageUrl),
    featured: l.featuredAt !== null,
    // Cheapest real rate (integer minor units); null for discovery-only listings and ones without prices.
    fromPrice: cheapest(l.rates),
    city: l.city,
    address: l.address,
    latitude: num(l.latitude),
    longitude: num(l.longitude),
    meetingPoint: l.meetingPoint,
    attributes: l.attributes,
    title: t?.title ?? null,
    summary: t?.summary ?? null,
    description: t?.description ?? null,
    locale: t?.locale ?? null,
    company: l.company ? { slug: l.company.slug, name: l.company.name, verified: true } : null,
  };
}
