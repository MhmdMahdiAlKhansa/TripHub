import {
  BadRequestException,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  Put,
  Query,
  Req,
  Res,
  UnsupportedMediaTypeException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { PrismaClient } from '@triphub/database';
import type { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import { SessionGuard } from '../auth/auth.guards';
import { readCapped } from '../companies/documents.service';
import { PRISMA } from '../database/database.module';
import { RateLimit } from '../ratelimit/ratelimit';
import { sniffType } from '../storage/file-sniff';
import { newStorageKey, STORAGE, type ObjectStorage } from '../storage/storage';
import { PermissionGuard, RequirePermission, TenantGuard, UUID_RE, type TenantRequest } from '../tenancy/tenancy.guards';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES_PER_LISTING = 8;
const MAX_PIXELS = 40_000_000; // refuse decompression bombs
const MAX_EDGE = 2000;
const WIDTHS = [320, 640, 1280] as const;

/**
 * Decodes the upload for real (so a file that only starts like an image is rejected), applies the camera
 * rotation, removes all metadata (EXIF, GPS, ICC comments) and stores a bounded-size WebP.
 */
export async function processImage(input: Buffer): Promise<Buffer> {
  try {
    return await sharp(input, { limitInputPixels: MAX_PIXELS, failOn: 'error' })
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    throw new UnsupportedMediaTypeException({ code: 'invalid_image' });
  }
}
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

const idOr404 = (id: string) => {
  if (!UUID_RE.test(id)) throw new NotFoundException();
  return id;
};

@Injectable()
export class ListingImagesService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(STORAGE) private readonly storage: ObjectStorage,
  ) {}

  private async ownListing(companyId: string, listingId: string) {
    const l = await this.db.listing.findFirst({ where: { id: listingId, companyId } });
    if (!l) throw new NotFoundException();
    if (l.status === 'ARCHIVED') throw new ConflictException({ code: 'listing_archived' });
    return l;
  }

  async add(companyId: string, actorId: string, listingId: string, data: Buffer, alt?: string) {
    await this.ownListing(companyId, listingId);
    const real = sniffType(data);
    if (!real || !IMAGE_TYPES.includes(real)) throw new UnsupportedMediaTypeException({ code: 'unsupported_image_type', allowed: ['png', 'jpeg', 'webp'] });
    data = await processImage(data);
    const live = await this.db.listingImage.count({ where: { listingId, deletedAt: null } });
    if (live >= MAX_IMAGES_PER_LISTING) throw new ConflictException({ code: 'too_many_images', max: MAX_IMAGES_PER_LISTING });
    const key = newStorageKey('img');
    await this.storage.put(key, data);
    try {
      return await this.db.listingImage.create({
        data: {
          listingId,
          storageKey: key,
          contentType: 'image/webp',
          sizeBytes: data.length,
          sha256: createHash('sha256').update(data).digest('hex'),
          alt: alt ?? null,
          position: live,
          uploadedBy: actorId,
        },
      });
    } catch (e) {
      await this.storage.remove(key);
      throw e;
    }
  }

  async list(companyId: string, listingId: string) {
    await this.ownListing(companyId, listingId);
    return this.db.listingImage.findMany({ where: { listingId, deletedAt: null }, orderBy: { position: 'asc' } });
  }

  async remove(companyId: string, listingId: string, id: string) {
    await this.ownListing(companyId, listingId);
    const img = await this.db.listingImage.findFirst({ where: { id, listingId, deletedAt: null } });
    if (!img) throw new NotFoundException();
    await this.db.listingImage.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.storage.remove(img.storageKey);
  }

  /** Public bytes, only for images of published listings of verified businesses. */
  async publicBytes(id: string) {
    const img = await this.db.listingImage.findFirst({
      where: { id, deletedAt: null, listing: { status: 'PUBLISHED', company: { status: 'APPROVED' } } },
    });
    if (!img) throw new NotFoundException();
    const data = await this.storage.get(img.storageKey);
    if (!data) throw new NotFoundException();
    return { img, data };
  }
}

const imageView = (i: { id: string; alt: string | null; position: number; contentType: string; sizeBytes: number }) => ({
  id: i.id,
  url: `/api/v1/public/listing-images/${i.id}`,
  alt: i.alt,
  position: i.position,
  contentType: i.contentType,
  sizeBytes: i.sizeBytes,
});

@ApiTags('listing-images')
@Controller({ path: 'companies/:companyId/listings/:listingId/images', version: '1' })
export class ListingImagesController {
  constructor(@Inject(ListingImagesService) private readonly svc: ListingImagesService) {}

  /** Raw-body upload of a PNG, JPEG or WebP (up to 5 MB); the type is decided from the bytes. */
  @Put()
  @RateLimit({ limit: 30, windowSec: 60 })
  @UseGuards(SessionGuard, TenantGuard, PermissionGuard)
  @RequirePermission('listing.write')
  async upload(@Req() req: TenantRequest & Request, @Param('listingId') listingId: string, @Query('alt') altRaw?: string) {
    const alt = z.string().trim().max(200).optional().safeParse(altRaw);
    if (!alt.success) throw new BadRequestException({ code: 'validation_error' });
    const ct = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    if (ct === 'application/json' || ct.startsWith('multipart/')) throw new UnsupportedMediaTypeException({ code: 'send_raw_file_body' });
    if (Number(req.headers['content-length'] ?? 0) > MAX_IMAGE_BYTES) throw new BadRequestException({ code: 'file_too_large', maxBytes: MAX_IMAGE_BYTES });
    const data = await readCapped(req, MAX_IMAGE_BYTES);
    return { image: imageView(await this.svc.add(req.membership!.companyId, req.user!.id, idOr404(listingId), data, alt.data || undefined)) };
  }

  @Get()
  @UseGuards(SessionGuard, TenantGuard, PermissionGuard)
  @RequirePermission('company.view')
  async list(@Req() req: TenantRequest, @Param('listingId') listingId: string) {
    return { images: (await this.svc.list(req.membership!.companyId, idOr404(listingId))).map(imageView) };
  }

  @Delete(':imageId')
  @HttpCode(204)
  @UseGuards(SessionGuard, TenantGuard, PermissionGuard)
  @RequirePermission('listing.write')
  async remove(@Req() req: TenantRequest, @Param('listingId') listingId: string, @Param('imageId') imageId: string) {
    await this.svc.remove(req.membership!.companyId, idOr404(listingId), idOr404(imageId));
  }
}

@ApiTags('public')
@Controller({ path: 'public/listing-images', version: '1' })
export class PublicListingImagesController {
  constructor(@Inject(ListingImagesService) private readonly svc: ListingImagesService) {}

  @Get(':id')
  @RateLimit({ limit: 600, windowSec: 60 })
  async get(@Param('id') id: string, @Query('w') w: string | undefined, @Res() res: Response) {
    const { img, data } = await this.svc.publicBytes(idOr404(id));
    let body = data;
    if (w !== undefined) {
      const width = Number(w);
      if (!(WIDTHS as readonly number[]).includes(width)) throw new BadRequestException({ code: 'invalid_width', allowed: WIDTHS });
      body = await sharp(data).resize({ width, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
    }
    res.setHeader('Content-Type', img.contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    // Images never change (immutable content, new upload = new id), so they cache well.
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.send(body);
  }
}
