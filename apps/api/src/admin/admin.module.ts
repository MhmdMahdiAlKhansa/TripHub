import { EmailAdminController } from './email-admin.controller';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminController } from './admin.controller';
import { PlatformGuard } from './admin.guards';
import { AdminService } from './admin.service';

@Module({
  imports: [AuthModule],
  controllers: [AdminController, EmailAdminController],
  providers: [AdminService, PlatformGuard],
})
export class AdminModule {}
