import path from 'node:path';
import { config } from 'dotenv';
import { Queue, Worker } from 'bullmq';
import { createPrismaClient } from '@triphub/database';
import { createHandlers, JOB_EXPIRE_HOLDS, JOB_SETTLE_SUBSCRIPTIONS, QUEUE_SYSTEM, runJob } from './jobs';

config({ path: path.resolve(__dirname, '../../../.env') });

const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6390');
const connection = {
  host: url.hostname,
  port: Number(url.port || 6379),
  maxRetriesPerRequest: null as null,
};

const db = createPrismaClient();
const handlers = createHandlers({ db });
const log = (level: string, msg: string, extra: object = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra }));

const worker = new Worker(
  QUEUE_SYSTEM,
  async (job) => {
    const result = await runJob(handlers, job.name, job.data);
    if (job.name === JOB_EXPIRE_HOLDS) {
      const r = result as { expired: number; offers: number };
      if (r.expired > 0 || r.offers > 0) log('info', 'holds expired / waitlist offers made', r);
    }
    return result;
  },
  { connection },
);
worker.on('failed', (job, err) => log('error', 'job failed', { job: job?.name, err: err.message }));

// Idempotent scheduler: re-registering updates the same schedule rather than duplicating it.
const queue = new Queue(QUEUE_SYSTEM, { connection });
void queue
  .upsertJobScheduler('expire-holds', { every: 60_000 }, { name: JOB_EXPIRE_HOLDS, opts: { removeOnComplete: 100, removeOnFail: 500 } })
  .then(() => queue.upsertJobScheduler('settle-subscriptions', { every: 600_000 }, { name: JOB_SETTLE_SUBSCRIPTIONS, opts: { removeOnComplete: 100, removeOnFail: 500 } }))
  .then(() => log('info', 'worker started', { queue: QUEUE_SYSTEM }));

async function shutdown() {
  await worker.close();
  await queue.close();
  await db.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
