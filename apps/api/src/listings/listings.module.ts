import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { defaultStorage, STORAGE } from '../storage/storage';
import { PermissionGuard, TenantGuard } from '../tenancy/tenancy.guards';
import { ListingImagesController, ListingImagesService, PublicListingImagesController } from './images';
import { ListingsController, PublicListingsController } from './listings.controller';
import { ListingsService } from './listings.service';

@Module({
  imports: [AuthModule],
  controllers: [ListingsController, PublicListingsController, ListingImagesController, PublicListingImagesController],
  providers: [ListingsService, ListingImagesService, TenantGuard, PermissionGuard, { provide: STORAGE, useFactory: defaultStorage }],
  exports: [ListingsService],
})
export class ListingsModule {}
