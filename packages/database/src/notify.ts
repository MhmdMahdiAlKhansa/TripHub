import type { Prisma, PrismaClient } from './generated/client';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Creates an in-app notification. Safe inside a transaction (it commits or rolls back with the event
 * it describes). It never contains secrets or other people's personal data: only ids and a kind that
 * the web app translates.
 */
export async function notify(db: Db, userId: string, kind: string, data: Record<string, string | number | null> = {}): Promise<void> {
  await db.notification.create({ data: { userId, kind, data } });
}
