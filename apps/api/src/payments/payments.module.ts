import { Module } from '@nestjs/common';
import { PlatformGuard } from '../admin/admin.guards';
import { AuthModule } from '../auth/auth.module';
import { LedgerService } from '../ledger/ledger.service';
import { PermissionGuard, TenantGuard } from '../tenancy/tenancy.guards';
import { AdminPaymentsController, CompanyRefundsController, CustomerPaymentsController, CustomerRefundsController } from './payments.controller';
import { AdminPayoutsController, CompanyPayoutsController } from './payouts.controller';
import { PayoutsService } from './payouts.service';
import { PaymentsService } from './payments.service';
import { RefundsService } from './refunds.service';

@Module({
  imports: [AuthModule],
  controllers: [CustomerPaymentsController, CustomerRefundsController, CompanyRefundsController, AdminPaymentsController, AdminPayoutsController, CompanyPayoutsController],
  providers: [PaymentsService, RefundsService, PayoutsService, LedgerService, PlatformGuard, TenantGuard, PermissionGuard],
  exports: [PaymentsService, LedgerService],
})
export class PaymentsModule {}
