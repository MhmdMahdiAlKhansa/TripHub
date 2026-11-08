import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CATEGORIES, LISTING_STATUSES, REGION_SLUGS, type ListingStatus } from '@triphub/shared';
import { z } from 'zod';
import { SessionGuard } from '../auth/auth.guards';
import { RateLimit } from '../ratelimit/ratelimit';
import { PermissionGuard, RequirePermission, TenantGuard, UUID_RE, type TenantRequest } from '../tenancy/tenancy.guards';
import { CreateListingDto, UpdateListingDto } from './listing.dto';
import { ListingsService, privateListing, publicListing } from './listings.service';

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) {
    throw new BadRequestException({
      code: 'validation_error',
      issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return r.data;
}
const idOr404 = (id: string) => {
  if (!UUID_RE.test(id)) throw new NotFoundException();
  return id;
};

@ApiTags('listings')
@Controller({ path: 'companies/:companyId/listings', version: '1' })
export class ListingsController {
  constructor(@Inject(ListingsService) private readonly svc: ListingsService) {}

  @Post()
  @RateLimit({ limit: 60, windowSec: 60 })
  @UseGuards(SessionGuard, TenantGuard, PermissionGuard)
  @RequirePermission('listing.write')
  async create(@Req() req: TenantRequest, @Body() body: unknown) {
    const l = await this.svc.create(req.membership!.companyId, req.user!.id, parse(CreateListingDto, body));
    return { listing: privateListing(l) };
  }

  @Get()
  @UseGuards(SessionGuard, TenantGuard, PermissionGuard)
  @RequirePermission('company.view')
  async list(@Req() req: TenantRequest, @Query('status') status?: string) {
    if (status && !(LISTING_STATUSES as readonly string[]).includes(status)) {
      throw new BadRequestException({ code: 'invalid_status' });
    }
    const rows = await this.svc.list(req.membership!.companyId, status as ListingStatus | undefined);
    return { listings: rows.map(privateListing) };
  }

  @Get(':listingId')
  @UseGuards(SessionGuard, TenantGuard, PermissionGuard)
  @RequirePermission('company.view')
  async get(@Req() req: TenantRequest, @Param('listingId') listingId: string) {
    return { listing: privateListing(await this.svc.get(req.membership!.companyId, idOr404(listingId))) };
  }

  @Patch(':listingId')
  @RateLimit({ limit: 120, windowSec: 60 })
  @UseGuards(SessionGuard, TenantGuard, PermissionGuard)
  @RequirePermission('listing.write')
  async update(@Req() req: TenantRequest, @Param('listingId') listingId: string, @Body() body: unknown) {
    const l = await this.svc.update(req.membership!.companyId, idOr404(listingId), req.user!.id, parse(UpdateListingDto, body));
    return { listing: privateListing(l) };
  }

  @Post(':listingId/publish')
  @HttpCode(200)
  @RateLimit({ limit: 30, windowSec: 60 })
  @UseGuards(SessionGuard, TenantGuard, PermissionGuard)
  @RequirePermission('listing.publish')
  async publish(@Req() req: TenantRequest, @Param('listingId') listingId: string) {
    return { listing: privateListing(await this.svc.transition(req.membership!.companyId, idOr404(listingId), req.user!.id, 'PUBLISHED')) };
  }

  @Post(':listingId/pause')
  @HttpCode(200)
  @RateLimit({ limit: 30, windowSec: 60 })
  @UseGuards(SessionGuard, TenantGuard, PermissionGuard)
  @RequirePermission('listing.publish')
  async pause(@Req() req: TenantRequest, @Param('listingId') listingId: string) {
    return { listing: privateListing(await this.svc.transition(req.membership!.companyId, idOr404(listingId), req.user!.id, 'PAUSED')) };
  }

  @Post(':listingId/archive')
  @HttpCode(200)
  @RateLimit({ limit: 30, windowSec: 60 })
  @UseGuards(SessionGuard, TenantGuard, PermissionGuard)
  @RequirePermission('listing.publish')
  async archive(@Req() req: TenantRequest, @Param('listingId') listingId: string) {
    return { listing: privateListing(await this.svc.transition(req.membership!.companyId, idOr404(listingId), req.user!.id, 'ARCHIVED')) };
  }
}

const PublicQuery = z.object({
  category: z.enum(CATEGORIES).optional(),
  city: z.string().trim().min(1).max(80).optional(),
  q: z.string().trim().min(1).max(120).optional(),
  locale: z.enum(['en', 'ar']).default('en'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().regex(UUID_RE).optional(),
  region: z.enum(REGION_SLUGS).optional(),
  // A day (Beirut time) and party size: only experiences with an open date and enough seats are returned.
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  guests: z.coerce.number().int().min(1).max(20).optional(),
  maxPriceMinor: z.coerce.number().int().min(0).max(100_000_000).optional(),
  mode: z.enum(['bookable', 'discovery']).optional(),
  featured: z.enum(['true']).optional(),
});

@ApiTags('public')
@Controller({ path: 'public/listings', version: '1' })
export class PublicListingsController {
  constructor(@Inject(ListingsService) private readonly svc: ListingsService) {}

  @Get()
  @RateLimit({ limit: 120, windowSec: 60 })
  async list(@Query() query: Record<string, unknown>) {
    const q = parse(PublicQuery, query);
    const { listings, nextCursor } = await this.svc.listPublic(q);
    return { listings: listings.map((l) => publicListing(l, q.locale)), nextCursor };
  }

  @Get(':id/nearby')
  @RateLimit({ limit: 120, windowSec: 60 })
  async nearby(@Param('id') id: string, @Query('locale') locale = 'en') {
    const rows = await this.svc.nearby(idOr404(id));
    return { listings: rows.map((l) => publicListing(l, locale === 'ar' ? 'ar' : 'en')) };
  }

  @Get(':id')
  @RateLimit({ limit: 120, windowSec: 60 })
  async get(@Param('id') id: string, @Query('locale') locale = 'en') {
    return { listing: publicListing(await this.svc.getPublic(idOr404(id)), locale === 'ar' ? 'ar' : 'en') };
  }
}
