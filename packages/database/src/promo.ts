import type { Prisma } from './generated/client';

type Tx = Prisma.TransactionClient;

/**
 * Gives a promo redemption back when its booking lapsed, was declined or was cancelled without a
 * verified payment. Idempotent: the redemption row is the single gate for the counter decrement.
 */
export async function releasePromoForBooking(tx: Tx, bookingId: string): Promise<boolean> {
  const r = await tx.promoRedemption.findUnique({ where: { bookingId } });
  if (!r) return false;
  const gone = await tx.promoRedemption.deleteMany({ where: { id: r.id } });
  if (gone.count !== 1) return false;
  await tx.promoCode.update({ where: { id: r.promoId }, data: { redeemed: { decrement: 1 } } });
  return true;
}
