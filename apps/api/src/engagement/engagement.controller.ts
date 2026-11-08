import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Inject, NotFoundException, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { User } from '@triphub/database';
import { z } from 'zod';
import { PlatformGuard, RequirePlatformPermission } from '../admin/admin.guards';
import { CurrentUser, SessionGuard, type AuthedRequest } from '../auth/auth.guards';
import { RateLimit } from '../ratelimit/ratelimit';
import { PermissionGuard, RequirePermission, TenantGuard, UUID_RE, type TenantRequest } from '../tenancy/tenancy.guards';
import { EngagementService } from './engagement.service';

const ReviewDto = z.object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().min(1).max(2000).optional() }).strict();
const ModerateDto = z.object({ status: z.enum(['VISIBLE', 'HIDDEN']), reason: z.string().trim().min(10).max(500) }).strict();
const ProfileDto = z
  .object({ displayName: z.string().trim().min(1).max(80).optional(), locale: z.enum(['en', 'ar']).optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'nothing to update');
const LocaleQuery = z.enum(['en', 'ar']).default('en');

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) {
    throw new BadRequestException({ code: 'validation_error', issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
  }
  return r.data;
}
const idOr404 = (id: string) => {
  if (!UUID_RE.test(id)) throw new NotFoundException();
  return id;
};
const reviewView = (r: { id: string; bookingId: string; listingId: string; rating: number; comment: string | null; status: string; moderationReason?: string | null; createdAt: Date }) => ({
  id: r.id,
  bookingId: r.bookingId,
  listingId: r.listingId,
  rating: r.rating,
  comment: r.comment,
  status: r.status,
  createdAt: r.createdAt,
});

@ApiTags('me')
@Controller({ path: 'me', version: '1' })
@UseGuards(SessionGuard)
export class MeController {
  constructor(@Inject(EngagementService) private readonly svc: EngagementService) {}

  @Patch('profile')
  @RateLimit({ limit: 30, windowSec: 60 })
  async profile(@CurrentUser() user: User, @Body() body: unknown) {
    return { user: await this.svc.updateProfile(user.id, parse(ProfileDto, body)) };
  }

  @Get('notifications')
  notifications(@CurrentUser() user: User) {
    return this.svc.notifications(user.id);
  }

  @Post('notifications/read-all')
  @HttpCode(204)
  async readAll(@CurrentUser() user: User) {
    await this.svc.markAllRead(user.id);
  }

  @Post('notifications/:id/read')
  @HttpCode(204)
  async read(@CurrentUser() user: User, @Param('id') id: string) {
    await this.svc.markRead(user.id, idOr404(id));
  }

  @Get('favorites')
  async favorites(@CurrentUser() user: User, @Query('locale') locale?: string) {
    return { listings: await this.svc.listFavorites(user.id, parse(LocaleQuery, locale)) };
  }

  @Put('favorites/:listingId')
  @HttpCode(204)
  @RateLimit({ limit: 60, windowSec: 60 })
  async add(@CurrentUser() user: User, @Param('listingId') listingId: string) {
    await this.svc.addFavorite(user.id, idOr404(listingId));
  }

  @Delete('favorites/:listingId')
  @HttpCode(204)
  async remove(@CurrentUser() user: User, @Param('listingId') listingId: string) {
    await this.svc.removeFavorite(user.id, idOr404(listingId));
  }

  @Post('bookings/:bookingId/review')
  @RateLimit({ limit: 20, windowSec: 60 })
  async review(@CurrentUser() user: User, @Param('bookingId') bookingId: string, @Body() body: unknown) {
    return { review: reviewView(await this.svc.createReview(user.id, idOr404(bookingId), parse(ReviewDto, body))) };
  }
}

@ApiTags('public')
@Controller({ path: 'public/listings/:listingId/reviews', version: '1' })
export class PublicReviewsController {
  constructor(@Inject(EngagementService) private readonly svc: EngagementService) {}

  @Get()
  @RateLimit({ limit: 120, windowSec: 60 })
  async list(@Param('listingId') listingId: string) {
    return this.svc.publicReviews(idOr404(listingId));
  }
}

@ApiTags('company-reviews')
@Controller({ path: 'companies/:companyId/reviews', version: '1' })
export class CompanyReviewsController {
  constructor(@Inject(EngagementService) private readonly svc: EngagementService) {}

  @Get()
  @UseGuards(SessionGuard, TenantGuard, PermissionGuard)
  @RequirePermission('booking.view')
  async list(@Req() req: TenantRequest) {
    return { reviews: (await this.svc.reviewsForCompany(req.membership!.companyId)).map(reviewView) };
  }
}

@ApiTags('admin-reviews')
@Controller({ path: 'admin/reviews', version: '1' })
@UseGuards(SessionGuard, PlatformGuard)
export class AdminReviewsController {
  constructor(@Inject(EngagementService) private readonly svc: EngagementService) {}

  @Get()
  @RequirePlatformPermission('review.moderate')
  async list(@Query('status') status = 'VISIBLE') {
    if (status !== 'VISIBLE' && status !== 'HIDDEN') throw new BadRequestException({ code: 'invalid_status' });
    return { reviews: (await this.svc.listForModeration(status)).map(reviewView) };
  }

  @Post(':id/moderate')
  @HttpCode(200)
  @RateLimit({ limit: 60, windowSec: 60 })
  @RequirePlatformPermission('review.moderate')
  async moderate(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const dto = parse(ModerateDto, body);
    return { review: reviewView(await this.svc.moderate(req.user!.id, idOr404(id), dto.status, dto.reason)) };
  }
}
