import { expireHoldsAndPromote, sendTripReminders, type PrismaClient } from '@triphub/database';
import { entitlementsFor, type AddOns, type PlanCode } from '@triphub/shared';

/**
 * Job registry. Every handler must be idempotent and retry-safe (spec section 25).
 */
export type JobHandler = (data: unknown) => Promise<unknown>;
export type Handlers = Record<string, JobHandler>;

export const QUEUE_SYSTEM = 'system';
export const JOB_EXPIRE_HOLDS = 'bookings.expireHolds';
export const JOB_SETTLE_SUBSCRIPTIONS = 'billing.settleSubscriptions';
export const JOB_TRIP_REMINDERS = 'bookings.tripReminders';

/** Persists the date-derived subscription status so reports agree with what the API enforces. */
export async function settleSubscriptions(db: PrismaClient, now = new Date()): Promise<number> {
  let n = 0;
  let cursor: string | undefined;
  for (;;) {
    // Walk every live subscription in id order, so a large table is never silently truncated.
    const subs = await db.subscription.findMany({
      where: { status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE'] } },
      orderBy: { id: 'asc' },
      take: 500,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (subs.length === 0) break;
    for (const s of subs) {
      const e = entitlementsFor(
        { planCode: s.planCode as PlanCode, status: s.status, trialEndsAt: s.trialEndsAt, currentPeriodEnd: s.currentPeriodEnd, cancelAtPeriodEnd: s.cancelAtPeriodEnd, addOns: s.addOns as AddOns },
        now,
      );
      if (e.status !== s.status) {
        await db.subscription.update({ where: { id: s.id }, data: { status: e.status } });
        n++;
      }
    }
    cursor = subs[subs.length - 1]!.id;
  }
  return n;
}

export function createHandlers(deps: { db: Pick<PrismaClient, 'hold' | '$transaction'> }): Handlers {
  return {
    'system.ping': async () => {},
    // Releases seats from holds whose time ran out, then offers freed seats to the waitlist (strict FIFO).
    // Safe to run concurrently and repeatedly.
    [JOB_SETTLE_SUBSCRIPTIONS]: async () => settleSubscriptions(deps.db as PrismaClient),
    [JOB_EXPIRE_HOLDS]: async () => expireHoldsAndPromote(deps.db as PrismaClient, { limit: 500 }),
    // One reminder per confirmed booking the day before the trip (the email outbox delivers it).
    [JOB_TRIP_REMINDERS]: async () => ({ sent: await sendTripReminders(deps.db as PrismaClient) }),
  };
}

export async function runJob(handlers: Handlers, name: string, data: unknown): Promise<unknown> {
  const handler = handlers[name];
  if (!handler) throw new Error(`No handler registered for job "${name}"`);
  return handler(data);
}
