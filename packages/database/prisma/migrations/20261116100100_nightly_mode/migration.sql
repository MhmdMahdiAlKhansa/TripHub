-- Booking mode for stays (kept in its own migration: a new enum value cannot be used in the transaction that adds it).
ALTER TYPE "BookingMode" ADD VALUE IF NOT EXISTS 'NIGHTLY';
