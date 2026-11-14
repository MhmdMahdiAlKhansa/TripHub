import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PermissionGuard, TenantGuard } from '../tenancy/tenancy.guards';
import { AvailabilityService } from './availability.service';
import {
  AvailabilityController,
  BookingsController,
  CompanyBookingsController,
  PublicAvailabilityController,
  WaitlistController,
} from './booking.controllers';
import { DepositsService } from './deposits.service';
import { BookingsService } from './bookings.service';
import { CompanyTicketsController, CustomerTicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';
import { WaitlistService } from './waitlist.service';

@Module({
  imports: [AuthModule],
  controllers: [AvailabilityController, PublicAvailabilityController, BookingsController, CompanyBookingsController, WaitlistController, CustomerTicketsController, CompanyTicketsController],
  providers: [AvailabilityService, BookingsService, DepositsService, WaitlistService, TicketsService, TenantGuard, PermissionGuard],
  exports: [BookingsService],
})
export class BookingModule {}
