import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@triphub/database';
import type { PostingLine } from '@triphub/shared';
import { PRISMA } from '../database/database.module';

type Tx = Prisma.TransactionClient;

export interface PostEntry {
  kind: string;
  /** Posting the same key twice is a no-op that returns the first entry. */
  idempotencyKey: string;
  description: string;
  currency: 'USD' | 'LBP';
  lines: PostingLine[];
  /** Company whose payable account COMPANY_PAYABLE lines refer to. */
  companyId?: string;
  bookingId?: string;
  paymentId?: string;
  postedBy?: string;
}

/**
 * Double-entry posting. The database independently enforces that each entry balances per currency,
 * that lines match their account's currency, and that nothing is ever updated or deleted.
 */
@Injectable()
export class LedgerService {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  /** Finds (or creates, race-safely) the ledger account a logical posting line refers to. */
  async accountId(tx: Tx, type: PostingLine['account'], currency: string, companyId?: string): Promise<string> {
    if (type === 'COMPANY_PAYABLE' && !companyId) throw new Error('COMPANY_PAYABLE requires a companyId');
    const where = { type, currency, companyId: type === 'COMPANY_PAYABLE' ? companyId : null } as const;
    const found = await tx.ledgerAccount.findFirst({ where });
    if (found) return found.id;
    await tx.ledgerAccount.createMany({ data: [where], skipDuplicates: true });
    return (await tx.ledgerAccount.findFirstOrThrow({ where })).id;
  }

  /** Must be called inside the transaction that records the business event it describes. */
  async post(tx: Tx, e: PostEntry): Promise<{ entryId: string; replay: boolean }> {
    if (e.lines.length < 2) throw new Error('a journal entry needs at least two lines');
    const sum = e.lines.reduce((s, l) => s + l.amountMinor, 0n);
    if (sum !== 0n) throw new Error(`journal entry does not balance (${sum})`);

    const existing = await tx.journalEntry.findUnique({ where: { idempotencyKey: e.idempotencyKey } });
    if (existing) return { entryId: existing.id, replay: true };

    const resolved = [];
    for (const l of e.lines) {
      resolved.push({ accountId: await this.accountId(tx, l.account, e.currency, e.companyId), amountMinor: l.amountMinor });
    }
    const entry = await tx.journalEntry.create({
      data: {
        kind: e.kind,
        idempotencyKey: e.idempotencyKey,
        description: e.description,
        bookingId: e.bookingId,
        paymentId: e.paymentId,
        postedBy: e.postedBy,
      },
    });
    await tx.ledgerLine.createMany({
      data: resolved.map((l) => ({ entryId: entry.id, accountId: l.accountId, amountMinor: l.amountMinor, currency: e.currency })),
    });
    return { entryId: entry.id, replay: false };
  }

  /** Balance per account type and currency. The grand total per currency is always zero. */
  async balances() {
    const rows = await this.db.ledgerLine.groupBy({
      by: ['accountId', 'currency'],
      _sum: { amountMinor: true },
    });
    const accounts = await this.db.ledgerAccount.findMany();
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const out = rows.map((r) => {
      const a = byId.get(r.accountId)!;
      return { type: a.type, companyId: a.companyId, currency: r.currency, balanceMinor: r._sum.amountMinor ?? 0n };
    });
    const totals: Record<string, bigint> = {};
    for (const r of out) totals[r.currency] = (totals[r.currency] ?? 0n) + r.balanceMinor;
    return { accounts: out, totalsByCurrency: totals };
  }
}
