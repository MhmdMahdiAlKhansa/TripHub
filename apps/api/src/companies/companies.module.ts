import { Module } from '@nestjs/common';
import { PlatformGuard } from '../admin/admin.guards';
import { AuthModule } from '../auth/auth.module';
import { defaultStorage, STORAGE } from '../storage/storage';
import { PermissionGuard, TenantGuard } from '../tenancy/tenancy.guards';
import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';
import { AdminDocumentsController, CompanyDocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

@Module({
  imports: [AuthModule],
  controllers: [CompaniesController, CompanyDocumentsController, AdminDocumentsController],
  providers: [CompaniesService, DocumentsService, TenantGuard, PermissionGuard, PlatformGuard, { provide: STORAGE, useFactory: defaultStorage }],
  exports: [CompaniesService],
})
export class CompaniesModule {}
