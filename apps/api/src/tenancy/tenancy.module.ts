import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenancyController } from './tenancy.controller';
import { PermissionGuard, TenantGuard } from './tenancy.guards';
import { TenancyService } from './tenancy.service';

@Module({
  imports: [AuthModule],
  controllers: [TenancyController],
  providers: [TenancyService, TenantGuard, PermissionGuard],
  exports: [TenancyService],
})
export class TenancyModule {}
