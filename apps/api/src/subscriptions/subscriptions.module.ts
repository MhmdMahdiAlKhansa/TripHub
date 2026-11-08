import { Global, Module } from '@nestjs/common';
import { PlatformGuard } from '../admin/admin.guards';
import { AuthModule } from '../auth/auth.module';
import { PermissionGuard, TenantGuard } from '../tenancy/tenancy.guards';
import { AdminSubscriptionsController, CompanySubscriptionController, PlansController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';

/** Global so listings, bookings and team management can enforce plan limits without import cycles. */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [PlansController, CompanySubscriptionController, AdminSubscriptionsController],
  providers: [SubscriptionsService, TenantGuard, PermissionGuard, PlatformGuard],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
