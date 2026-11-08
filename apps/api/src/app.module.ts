import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { securityHeaders } from './observability/security-headers';
import { PrismaClient } from '@triphub/database';
import { FeaturesModule } from './config/features';
import { AdminModule } from './admin/admin.module';
import { ContentModule } from './content/content.module';
import { MarketingModule } from './marketing/marketing.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { EngagementModule } from './engagement/engagement.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { PaymentsModule } from './payments/payments.module';
import { BookingModule } from './booking/booking.module';
import { ListingsModule } from './listings/listings.module';
import { CompaniesModule } from './companies/companies.module';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule, PRISMA } from './database/database.module';
import { ObservabilityModule } from './observability/observability';
import { RateLimitModule } from './ratelimit/ratelimit';
import { TenancyModule } from './tenancy/tenancy.module';
import { HealthController } from './health/health.controller';
import { DB_PING } from './health/health.tokens';

@Module({
  imports: [FeaturesModule, ObservabilityModule, DatabaseModule, RateLimitModule, AuthModule, TenancyModule, CompaniesModule, AdminModule, ListingsModule, BookingModule, PaymentsModule, SubscriptionsModule, EngagementModule, AnalyticsModule, MarketingModule, ContentModule],
  controllers: [HealthController],
  providers: [
    {
      provide: DB_PING,
      inject: [PRISMA],
      useFactory: (db: PrismaClient) => async () => {
        await db.$queryRaw`SELECT 1`;
      },
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(securityHeaders).forRoutes('*path');
  }
}
