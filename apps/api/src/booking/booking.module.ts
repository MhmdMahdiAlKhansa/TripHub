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
  PublicStaysController,
  StaysController,
  CompanyStaysController,
} from './booking.controllers';
import { DepositsService } from './deposits.service';
import { StaysService } from './stays.service';
import { BookingsService } from './bookings.service';
import { CompanyTicketsController, CustomerTicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';
import { WaitlistService } from './waitlist.service';

@Module({
  imports: [AuthModule],
  controllers: [AvailabilityController, PublicAvailabilityController, BookingsController, CompanyBookingsController, WaitlistController, CustomerTicketsController, CompanyTicketsController, PublicStaysController, StaysController, CompanyStaysController],
  providers: [AvailabilityService, BookingsService, DepositsService, StaysService, WaitlistService, TicketsService, TenantGuard, PermissionGuard],
  exports: [BookingsService],
})
export class BookingModule {}
