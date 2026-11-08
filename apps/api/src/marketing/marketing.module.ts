import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PermissionGuard, TenantGuard } from '../tenancy/tenancy.guards';
import { PromoController } from './promo.controller';
import { PromoService } from './promo.service';

@Global()
@Module({
  imports: [AuthModule],
  controllers: [PromoController],
  providers: [PromoService, TenantGuard, PermissionGuard],
  exports: [PromoService],
})
export class MarketingModule {}
