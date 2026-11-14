import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client';

export * from './generated/client';
export * from './capacity';
export * from './waitlist';

export function createPrismaClient(connectionString = process.env.DATABASE_URL): PrismaClient {
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  // Pool size is tunable (DATABASE_POOL_MAX); the default suits one API process behind a modest Postgres.
  const max = Number(process.env.DATABASE_POOL_MAX ?? 20);
  return new PrismaClient({ adapter: new PrismaPg({ connectionString, max }) });
}
export * from './notify';
export * from './promo';
export * from './reminders';
