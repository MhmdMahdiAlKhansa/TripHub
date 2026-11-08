import { Module } from '@nestjs/common';
import { PlatformGuard } from '../admin/admin.guards';
import { AuthModule } from '../auth/auth.module';
import { ListingsModule } from '../listings/listings.module';
import { PermissionGuard, TenantGuard } from '../tenancy/tenancy.guards';
import { AdminReviewsController, CompanyReviewsController, MeController, PublicReviewsController } from './engagement.controller';
import { EngagementService } from './engagement.service';

@Module({
  imports: [AuthModule, ListingsModule],
  controllers: [MeController, PublicReviewsController, CompanyReviewsController, AdminReviewsController],
  providers: [EngagementService, TenantGuard, PermissionGuard, PlatformGuard],
})
export class EngagementModule {}
