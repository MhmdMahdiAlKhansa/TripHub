import { Module } from '@nestjs/common';
import { PlatformGuard } from '../admin/admin.guards';
import { AuthModule } from '../auth/auth.module';
import { AdminContentController, PublicFxController } from './content.controller';
import { ContentService } from './content.service';

@Module({
  imports: [AuthModule],
  controllers: [PublicFxController, AdminContentController],
  providers: [ContentService, PlatformGuard],
})
export class ContentModule {}
